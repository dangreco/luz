import type { Layout } from '../model/layout';
import type { LampParams, ShadeParams } from '../model/params';
import type { ShadeSurface } from '../model/shadeSurface';
import { angles, sectionRadius } from '../model/section';
import { textureField, textureSampling } from '../model/texture';
import type { SolidPart } from './build';
import { loftSolid, loftTube } from './mesh';
import type { Vec3 } from './mesh';
import type { Manifold, ManifoldToplevel } from './wasm';
import { buildBasketStrands } from './shade/basket';
import { basisFrom, clamp, orientedBox, TAU } from './shade/common';
import { perfCutters } from './shade/perf';

/**
 * Shade body (and the separate fitter for `mount === 'fitter'`), in assembled world
 * coordinates. Surface styles only ever add material outward of the nominal outer
 * surface, and the inner wall never comes closer to the axis than the nominal
 * `innerRadius`, which is what bulb-clearance and safety checks rely on.
 */
export function buildShadeParts(m: ManifoldToplevel, p: LampParams, layout: Layout): SolidPart[] {
  const sh = p.shade;
  const S: ShadeSurface = layout.shade;
  const notes: string[] = [];
  const z0 = layout.shadeBottom;
  const z1 = layout.shadeTop;
  const axisX = layout.axisX;
  const axisY = layout.axisY;
  const H = S.height;
  const n = angularSamples(p);
  const nr = ringCount(p, H);
  const phis = angles(n);

  // --- fitter seat: recessed groove in the bottom band + inward lip at its top edge ---
  const hasFitter = sh.mount === 'fitter';
  const lipZ = z0 + sh.mountHeight + sh.fitterRimHeight;
  const recess = hasFitter ? clamp(sh.wallThickness * 0.6, 0.8, 1.6) : 0;
  const grooveAt = (z: number): number =>
    hasFitter ? recess * clamp((lipZ + Math.max(0.4, recess) - z) / Math.max(0.4, recess), 0, 1) : 0;

  // --- style relief fields (>= 0, outward only) ---
  const ribD = sh.style === 'ribs' ? ribField(sh) : null;
  const texD = sh.style === 'textured' ? textureField(sh.texture) : null;
  const dispOut = (t: number, phi: number): number =>
    (ribD ? ribD(t, phi) : 0) + (texD ? texD(phi, t) : 0) + grooveAt(z0 + t * H);
  const dispIn = (t: number, phi: number): number =>
    (ribD && sh.ribCorrugated ? ribD(t, phi) : 0) + grooveAt(z0 + t * H);

  // --- sampled rings (actual surfaces: nominal + style relief + seat groove) ---
  const outerR: Vec3[][] = [];
  const innerR: Vec3[][] = [];
  const innerRad: number[][] = [];
  let minWall = Infinity;
  for (let i = 0; i < nr; i++) {
    const t = i / (nr - 1);
    const z = z0 + t * H;
    const og: Vec3[] = [];
    const ig: Vec3[] = [];
    const ir: number[] = [];
    for (let k = 0; k < n; k++) {
      const phi = phis[k];
      const cs = Math.cos(phi);
      const sn = Math.sin(phi);
      const ro = S.outerRadius(t, phi) + dispOut(t, phi);
      const ri = S.innerRadius(t, phi) + dispIn(t, phi);
      og.push([axisX + ro * cs, axisY + ro * sn, z]);
      ig.push([axisX + ri * cs, axisY + ri * sn, z]);
      ir.push(ri);
      if (ro - ri < minWall) minWall = ro - ri;
    }
    outerR.push(og);
    innerR.push(ig);
    innerRad.push(ir);
  }
  /** Interpolated actual inner radius at height z along a given direction (nearest angular sample). */
  const innerAt = (z: number, phi: number): number => {
    const x = clamp((z - z0) / H, 0, 1) * (nr - 1);
    const i = Math.min(nr - 2, Math.floor(x));
    const f = x - i;
    const k = ((Math.round((phi / TAU) * n) % n) + n) % n;
    return innerRad[i][k] + (innerRad[i + 1][k] - innerRad[i][k]) * f;
  };
  const minInnerInBand = (zA: number, zB: number): number => {
    let mn = Infinity;
    for (let i = 0; i <= 8; i++) {
      const t = clamp((zA + ((zB - zA) * i) / 8 - z0) / H, 0, 1);
      for (let k = 0; k < n; k++) {
        const r = S.innerRadius(t, phis[k]);
        if (r < mn) mn = r;
      }
    }
    return mn;
  };

  // --- vase mode (solid outer body for spiral slicing) ---
  const vaseStyle =
    sh.style === 'smooth' || (sh.style === 'ribs' && sh.ribCorrugated) || sh.style === 'textured';
  const vaseBlockers: string[] = [];
  if (!vaseStyle) vaseBlockers.push(`the ${sh.style} style needs a two-sided wall`);
  if (sh.topClosure !== 'open') vaseBlockers.push('the top is not open');
  if (sh.mount === 'spider') vaseBlockers.push('the spider mount is integrated into the shade');
  const vase = sh.vaseMode && vaseBlockers.length === 0;
  if (sh.vaseMode && !vase) notes.push(`Vase mode ignored: ${vaseBlockers.join('; ')}.`);

  // --- spider spoke ends (solved per spoke direction, so non-round shades are reached exactly) ---
  const hubR = sh.hubOuterDiameter / 2;
  const riseRad = clamp(sh.spokeRise, 0, 80) * (Math.PI / 180);
  // the spoke's square end is tilted by the rise, so its lower corner reaches thickness/2·sin(rise) further
  // out than the centreline end point: pull the end in by that so the bite never pierces the outer wall
  const tiltReach = (sh.spokeThickness / 2) * Math.sin(clamp(sh.spokeRise, 0, 80) * (Math.PI / 180));
  const bite = Math.max(0.2, clamp(sh.wallThickness * 0.75, 0.4, 1.2) - tiltReach);
  const spokeBase = layout.hubBottom + sh.hubThickness / 2; // inner end of every spoke
  const spokeCount = Math.max(1, Math.round(sh.spokeCount));
  const spokeEnds: Array<{ phi: number; r: number; z: number }> = [];
  if (sh.mount === 'spider') {
    let short = false;
    for (let s = 0; s < spokeCount; s++) {
      const phi = (TAU * s) / spokeCount;
      let z = spokeBase;
      for (let it = 0; it < 12; it++) {
        const r = Math.max(innerAt(z, phi) + bite, hubR + 0.5);
        const zNext = riseRad > 1e-3 ? Math.min(z1 - 2, spokeBase + (r - hubR) / Math.tan(riseRad)) : spokeBase;
        if (Math.abs(zNext - z) < 1e-3) break;
        z = zNext;
      }
      if (innerAt(z, phi) < hubR) short = true;
      spokeEnds.push({ phi, r: Math.max(innerAt(z, phi) + bite, hubR + 0.5), z });
    }
    if (short) notes.push('Hub is wider than the shade at the mount height; spokes may not reach the wall.');
  }
  const spokeZ = spokeEnds.length ? Math.max(...spokeEnds.map((e) => e.z)) : spokeBase;

  // --- short tube between (offset) nominal surfaces: rim bands, seat, spoke band ---
  const bandSolid = (
    zLo: number,
    zHi: number,
    innerOff: number,
    outerFn: (t: number, phi: number) => number,
  ): Manifold => {
    const zTop = Math.max(zHi, zLo + 0.05);
    // rounded shoulders curve sharply near the rims; follow the main ring spacing there (no 2 mm floor)
    const minStep = sh.bottomRounding > 0 || sh.topRounding > 0 ? 0.25 : 2;
    const nz = Math.max(2, Math.ceil((zTop - zLo) / Math.max(minStep, H / (nr - 1))) + 1);
    const og: Vec3[][] = [];
    const ig: Vec3[][] = [];
    for (let i = 0; i < nz; i++) {
      const t = clamp((zLo + ((zTop - zLo) * i) / (nz - 1) - z0) / H, 0, 1);
      const z = z0 + t * H;
      const a: Vec3[] = [];
      const b: Vec3[] = [];
      for (let k = 0; k < n; k++) {
        const phi = phis[k];
        const cs = Math.cos(phi);
        const sn = Math.sin(phi);
        const ro = outerFn(t, phi);
        const ri = S.innerRadius(t, phi) + innerOff;
        a.push([axisX + ro * cs, axisY + ro * sn, z]);
        b.push([axisX + ri * cs, axisY + ri * sn, z]);
      }
      og.push(a);
      ig.push(b);
    }
    return loftTube(m, og, ig);
  };

  // --- body per style ---
  let body: Manifold;
  let bodyMinWall = minWall;
  let weaveBulge = 0;
  if (sh.style === 'basket') {
    const rim = clamp(sh.basketRim, 1, H * 0.4);
    // For the base mount the rims stay at the nominal outer surface so the shade
    // still seats in the base groove; otherwise cover the strand stack-up.
    const bandOuter = (t: number, phi: number): number => {
      const out = S.outerRadius(t, phi);
      return sh.mount === 'base' ? out : Math.max(out, S.innerRadius(t, phi) + weaveBulge);
    };
    // strands stay off rounded shoulders: the solid rim band follows the curve there
    let strandLo = z0 + Math.max(rim, Math.min(sh.bottomRounding, H * 0.4));
    if (hasFitter) strandLo = Math.max(strandLo, lipZ + Math.max(3, rim));
    const strandHi = z1 - Math.max(rim, Math.min(sh.topRounding, H * 0.4));
    const weave =
      strandHi - strandLo > 2 * sh.basketStrandWidth
        ? buildBasketStrands(m, sh, S, axisX, axisY, z0, strandLo - 0.6, strandHi + 0.6)
        : { strands: [], bulge: 0 };
    weaveBulge = weave.bulge;
    const parts: Manifold[] = [...weave.strands];
    if (weave.strands.length === 0) {
      notes.push('Basket strands skipped: the rim/mount bands leave no weaving height.');
      parts.push(bandSolid(hasFitter ? Math.min(z1 - 0.5, lipZ + Math.max(3, rim)) : z0, z1, 0, bandOuter));
    } else {
      // rim bands only: the weave zone itself is the strands
      if (!hasFitter) parts.push(bandSolid(z0, strandLo, 0, bandOuter));
      parts.push(bandSolid(strandHi, z1, 0, bandOuter));
    }
    if (hasFitter) {
      // seat groove: recessed band under the lip, then a normal band up to the weave start
      parts.push(
        bandSolid(z0, lipZ, recess, (t, phi) => bandOuter(t, phi) + recess),
        bandSolid(lipZ, Math.min(z1, Math.max(lipZ + 0.5, Math.min(strandHi, lipZ + Math.max(3, rim)))), 0, bandOuter),
      );
    }
    body = m.Manifold.union(parts);
    bodyMinWall = Math.min(sh.basketStrandThickness, sh.wallThickness, weave.bulge);
    if (Math.round(sh.basketStrands) % 2 === 1)
      notes.push(
        'Odd basket strand count weaves with one same-phase seam row per revolution; use an even count for a perfect checkerboard.',
      );
  } else if (vase) {
    body = loftSolid(m, outerR);
    bodyMinWall = sh.vaseLineWidth;
    notes.push(
      `Slice in spiral vase mode, line width = ${sh.vaseLineWidth} mm (shade exported as a solid; wall thickness is set by the slicer).`,
    );
  } else {
    body = loftTube(m, outerR, innerR);
  }

  // --- perforations (cut before the mount is unioned in) ---
  if (sh.style === 'perforated' && !vase) {
    let perfLo = z0 + sh.perfMargin;
    if (sh.mount === 'spider') perfLo = Math.max(perfLo, spokeZ + Math.max(3, sh.perfSpacing));
    if (hasFitter) perfLo = Math.max(perfLo, lipZ + Math.max(3, sh.perfSpacing));
    const perfHi = z1 - sh.perfMargin;
    if (perfHi - perfLo > sh.perfSize * 0.8) {
      const cutter = perfCutters(m, sh, S, axisX, axisY, z0, perfLo, perfHi);
      if (cutter) body = body.subtract(cutter);
    } else {
      notes.push('Perforation skipped: the rim margins and mount keep-out leave no room for holes.');
    }
  }

  // --- top closure ---
  if (sh.topClosure !== 'open' && !vase) {
    const capT = clamp(1 - sh.topThickness / H, 0.02, 0.98);
    const capRing = (t: number): Vec3[] => {
      const z = z0 + t * H;
      const g: Vec3[] = [];
      for (let k = 0; k < n; k++) {
        const phi = phis[k];
        const r =
          sh.style === 'basket'
            ? Math.max(S.outerRadius(t, phi), S.innerRadius(t, phi) + weaveBulge)
            : S.outerRadius(t, phi) + dispOut(t, phi);
        // a hair proud so the cap merges with the wall without sliver faces
        g.push([axisX + (r + 0.02) * Math.cos(phi), axisY + (r + 0.02) * Math.sin(phi), z]);
      }
      return g;
    };
    body = body.add(loftSolid(m, [capRing(capT), capRing(1)]));
    if (sh.topClosure === 'vented') {
      let rinMin = Infinity;
      for (let k = 0; k < n; k++) rinMin = Math.min(rinMin, S.innerRadius(1, phis[k]));
      const vr = sh.ventDiameter / 2;
      const count = Math.max(1, Math.round(sh.ventCount));
      const rMin = vr + 1.2;
      const rMax = rinMin - vr - 1.2;
      // hole centres need enough circumference: chord(rv) >= ventDiameter + web
      const rvNeed = (sh.ventDiameter + 1.5) / (2 * Math.sin(Math.PI / count));
      if (rMax < Math.max(rMin, rvNeed)) {
        notes.push(
          `Vents skipped: ${count} × Ø${sh.ventDiameter.toFixed(0)} mm holes do not fit inside the top (inradius ${rinMin.toFixed(0)} mm).`,
        );
      } else {
        const rv = clamp(0.55 * rinMin, Math.max(rMin, rvNeed), rMax);
        const holes: Manifold[] = [];
        for (let i = 0; i < count; i++) {
          const a = (TAU * i) / count;
          holes.push(
            m.Manifold
              .cylinder(sh.topThickness + 2, vr, vr, 24)
              .translate(axisX + rv * Math.cos(a), axisY + rv * Math.sin(a), z0 + capT * H - 1),
          );
        }
        body = body.subtract(m.Manifold.union(holes));
      }
    }
  }

  // --- integrated spider: hub + spokes merged into the wall ---
  const hubSolid = (): Manifold => {
    const seg = Math.max(48, Math.ceil(sh.hubOuterDiameter * 6));
    const ring = m.Manifold.cylinder(sh.hubThickness, hubR, hubR, seg).translate(axisX, axisY, layout.hubBottom);
    const hole = m.Manifold
      .cylinder(sh.hubThickness + 2, layout.hubHoleDiameter / 2, layout.hubHoleDiameter / 2, 48)
      .translate(axisX, axisY, layout.hubBottom - 1);
    return ring.subtract(hole);
  };
  /** One tilted box per spoke from inside the hub to its own end point (radius, height). */
  const spokes = (ends: Array<{ phi: number; r: number; z: number }>): Manifold[] => {
    const out: Manifold[] = [];
    const r0 = Math.max(0, hubR - 1); // embedded in the hub
    const za = layout.hubBottom + sh.hubThickness / 2; // centred in the hub at the inner end
    for (const { phi, r, z } of ends) {
      const r1 = Math.max(r, r0 + 0.5);
      const zb = clamp(z, za + 0.01, z1 - 0.5);
      const dx = (r1 - r0) * Math.cos(phi);
      const dy = (r1 - r0) * Math.sin(phi);
      const len = Math.hypot(dx, dy, zb - za);
      if (len < 0.5) continue;
      const { ex, ey, ez } = basisFrom([dx / len, dy / len, (zb - za) / len], [-Math.sin(phi), Math.cos(phi), 0]);
      out.push(
        orientedBox(
          m,
          [axisX + ((r0 + r1) / 2) * Math.cos(phi), axisY + ((r0 + r1) / 2) * Math.sin(phi), (za + zb) / 2],
          ex,
          ey,
          ez,
          len,
          sh.spokeWidth,
          sh.spokeThickness,
        ),
      );
    }
    return out;
  };
  if (sh.mount === 'spider') {
    const parts = [body, hubSolid(), ...spokes(spokeEnds)];
    if (sh.style === 'basket') {
      // local solid ring band so the spokes have wall material to merge into
      const bh = Math.max(sh.spokeThickness + 2, 4);
      const bz0 = clamp(spokeZ - bh / 2, z0, z1 - 1);
      const bandOuter = (t: number, phi: number): number =>
        Math.max(S.outerRadius(t, phi), S.innerRadius(t, phi) + weaveBulge);
      parts.push(bandSolid(bz0, Math.min(z1, bz0 + bh), 0, bandOuter));
      notes.push(`Solid band added around the spokes at z = ${bz0.toFixed(0)} mm (basket weave).`);
    }
    body = m.Manifold.union(parts);
  }

  const printFlip = sh.topClosure !== 'open' && sh.mount !== 'spider';
  notes.unshift(`Shade min wall ${bodyMinWall.toFixed(2)} mm.`);
  if (printFlip) notes.push('Print upside-down: the flat closed top goes on the bed.');
  else if (sh.topClosure !== 'open')
    notes.push('Print right-side up: flipping would leave the spider hub and spokes unsupported.');

  const parts: SolidPart[] = [
    { id: 'shade', label: 'Shade', solid: body, printFlip, notes, printedShell: vase ? sh.vaseLineWidth : undefined },
  ];

  // --- separate fitter: hub + spokes + rim seating in the shade groove ---
  if (hasFitter) {
    const rSeat = minInnerInBand(z0, lipZ) + recess;
    const ringOD = rSeat - sh.fitterClearance;
    const rt = Math.max(2.5, sh.spokeThickness * 1.6);
    const ringID = ringOD - rt;
    const ringTop = layout.hubBottom + sh.fitterRimHeight;
    // spokes reach the rim inner face; clamp the rise so they stay under the rim top
    const zMax = ringTop - sh.spokeThickness / 2 - 0.2;
    let zEnd = spokeBase;
    if (riseRad > 1e-3) zEnd = Math.min(zMax, spokeBase + (ringID - hubR) / Math.tan(riseRad));
    const seg = Math.max(64, Math.ceil(2 * ringOD * 6));
    const ring = m.Manifold
      .cylinder(sh.fitterRimHeight, ringOD, ringOD, seg)
      .translate(axisX, axisY, layout.hubBottom)
      .subtract(
        m.Manifold.cylinder(sh.fitterRimHeight + 2, ringID, ringID, seg).translate(axisX, axisY, layout.hubBottom - 1),
      );
    // spokes end embedded in the rim wall (0.4 mm shy of its outer face) so they merge without a lip
    const fitterEnds = Array.from({ length: spokeCount }, (_, s) => ({ phi: (TAU * s) / spokeCount, r: ringOD - 0.4, z: zEnd }));
    const fitter = m.Manifold.union([hubSolid(), ring, ...spokes(fitterEnds)]);
    notes.push(
      `Fitter seat: groove z ${z0.toFixed(0)}–${lipZ.toFixed(0)} mm, rim Ø${(2 * ringOD).toFixed(1)} mm, ${recess.toFixed(1)} mm lip.`,
    );
    parts.push({
      id: 'fitter',
      label: 'Fitter (hub + spokes + rim)',
      solid: fitter,
      printFlip: false,
      notes: [
        `Rim Ø${(2 * ringOD).toFixed(1)} mm × ${sh.fitterRimHeight} mm seats in the shade groove with ${sh.fitterClearance} mm clearance.`,
        'Print hub-down on the flat annulus; spokes rise at the configured angle.',
      ],
    });
  }
  return parts;
}

/** Angular sampling: quality setting, raised for ribs/weave and until the chordal
 *  faceting of a polygon section stays within ~0.03 mm of its true polar curve. */
function angularSamples(p: LampParams): number {
  let n = Math.max(24, Math.round(p.quality.radialSegments));
  if (p.shade.style === 'ribs') n = Math.max(n, Math.ceil(Math.max(2, p.shade.ribCount) * 8));
  if (p.shade.style === 'textured') n = Math.max(n, textureSampling(p.shade.texture).around);
  while (n < 768 && chordError(p.shade, n) > 0.03) n *= 2;
  return n;
}

/** Worst inward chord error (mm) when sampling the unit section polar curve at n angles. */
function chordError(sh: ShadeParams, n: number): number {
  let worst = 0;
  for (const sec of [sh.bottomSection, sh.topSection]) {
    if (sec.kind === 'circle') continue;
    for (let i = 0; i < n; i++) {
      const a0 = (TAU * i) / n;
      const a1 = (TAU * (i + 1)) / n;
      const r0 = sectionRadius(sec, a0);
      const r1 = sectionRadius(sec, a1);
      const rm = sectionRadius(sec, (a0 + a1) / 2);
      const mx = (r0 * Math.cos(a0) + r1 * Math.cos(a1)) / 2;
      const my = (r0 * Math.sin(a0) + r1 * Math.sin(a1)) / 2;
      const err = rm - Math.hypot(mx, my);
      if (err > worst) worst = err;
    }
  }
  return worst * Math.max(sh.bottomSize, sh.topSize);
}

/** Vertical ring sampling: quality setting, raised so every texture row gets enough rings. */
function ringCount(p: LampParams, height: number): number {
  let nr = Math.ceil((height / 10) * p.quality.ringsPer10mm) + 1;
  if (p.shade.style === 'textured') nr = Math.max(nr, textureSampling(p.shade.texture).along);
  if (p.shade.rippleCount > 0) nr = Math.max(nr, Math.round(p.shade.rippleCount) * 16 + 1);
  if (p.shade.bottomRounding > 0 || p.shade.topRounding > 0) nr = Math.max(nr, Math.ceil(height / 2) + 1);
  return Math.max(2, nr);
}

/** Radial rib relief d(t, phi) >= 0: waveform × count, extra twist, fading out at both rims. */
function ribField(sh: ShadeParams): (t: number, phi: number) => number {
  const count = Math.max(2, Math.round(sh.ribCount));
  const depth = Math.max(0, sh.ribDepth);
  const twist = (sh.ribTwist * Math.PI) / 180;
  const fade = clamp(sh.ribFade, 0, 0.45);
  const wave = ribWave(sh.ribWave);
  return (t, phi) => {
    if (depth <= 0) return 0;
    let f = 1;
    if (fade > 0) {
      const e = clamp(Math.min(t, 1 - t) / fade, 0, 1);
      f = e * e * (3 - 2 * e);
    }
    if (f <= 0) return 0;
    const u = (((phi - twist * t) * count) / TAU) % 1;
    return depth * wave(u < 0 ? u + 1 : u) * f;
  };
}

/** Rib waveform, x ∈ [0,1) → [0,1]. */
function ribWave(kind: ShadeParams['ribWave']): (x: number) => number {
  switch (kind) {
    case 'sine':
      return (x) => 0.5 - 0.5 * Math.cos(TAU * x);
    case 'triangle':
      return (x) => 1 - Math.abs(2 * x - 1);
    case 'square':
      // tanh-smoothed square wave
      return (x) => 0.5 + 0.5 * Math.tanh(Math.sin(TAU * x) / 0.35);
    case 'scallop':
      return (x) => Math.sqrt(Math.max(0, 1 - (2 * x - 1) * (2 * x - 1)));
  }
}
