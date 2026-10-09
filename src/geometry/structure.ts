import { CORD_CLEAR, cordBoreDiameter, type Layout, type WagoSlot } from '../model/layout';
import type { EdgeStyle, JointParams, LampParams, SectionParams } from '../model/params';
import { WAGO_CONNECTORS } from '../model/hardware';
import { angles, sectionRadius, sectionRing } from '../model/section';
import { textureField, textureSampling } from '../model/texture';
import type { SolidPart } from './build';
import { loftSolid, loftTube, type Vec3 } from './mesh';
import type { Manifold, ManifoldToplevel } from './wasm';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Rings used to approximate each rounded/chamfered edge band of a loft. */
const EDGE_SEGS = 6;
/** Rings used for the conical flare between the cup's bottom bore and its cavity. */
const CONE_SEGS = 4;
/** Extra reach given to every cutting bore so boolean faces never coincide. */
const THROUGH = 1;
/** How far a fused joint embeds its loft into the mating body (guarantees a solid union). */
const FUSE_EMBED = 0.6;

/** The cavity and every internal bore of the cup is round. */
const circleSection: SectionParams = {
  kind: 'circle',
  sides: 12,
  cornerRadius: 1,
  exponent: 4,
  aspect: 1,
  rotation: 0,
};
/** Hex recess that stops the 1/8 IPS nut from turning. */
const hexSection: SectionParams = {
  kind: 'polygon',
  sides: 6,
  cornerRadius: 0.02,
  exponent: 4,
  aspect: 1,
  rotation: 0,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function r1(x: number): string {
  return x.toFixed(1);
}

/** XY ring of `section` at world z about (cx, cy), inset where given. */
function ringAt(
  section: SectionParams,
  size: number,
  z: number,
  phis: Float64Array,
  twistDeg: number,
  inset: number,
  cx = 0,
  cy = 0,
): Vec3[] {
  return sectionRing(section, size, phis, twistDeg, inset).map(
    (pt) => [pt[0] + cx, pt[1] + cy, z] as Vec3,
  );
}

/** Smallest polar radius of a section sampled at `phis`, scaled by `size` (a lower bound on the inradius). */
function minInradius(section: SectionParams, size: number, phis: Float64Array): number {
  let r = Infinity;
  for (let i = 0; i < phis.length; i++) r = Math.min(r, sectionRadius(section, phis[i]) * size);
  return r;
}

/**
 * Inward inset of the section ring `t` mm above an edge broken with radius `r`:
 * a quarter-circle for a fillet, a straight slope for a chamfer.
 */
function edgeInset(style: EdgeStyle, radius: number, t: number): number {
  if (radius <= 0 || t >= radius) return 0;
  if (style === 'chamfer') return radius - t;
  return radius - Math.sqrt(Math.max(0, t * (2 * radius - t)));
}

interface ProfileLoft {
  section: SectionParams;
  sizeBottom: number;
  sizeTop: number;
  twist: number;
  /** world z of the nominal bottom ring */
  z0: number;
  height: number;
  style: EdgeStyle;
  bottomRadius: number;
  topRadius: number;
  cx?: number;
  cy?: number;
  /** continue the end ring downward/upward (fused-joint embed) */
  extendDown?: number;
  extendUp?: number;
  /** outward relief d(phi, v) on the straight wall between the edge bands (v = 0..1 over that band) */
  relief?: (phi: number, v: number) => number;
  /** extra rings through the straight wall (texture rows) */
  wallRings?: number;
}

/**
 * Loft a body whose vertical section profile rounds or chamfers the bottom and top edges:
 * the ring is inset by the edge profile at each height (a profile-swept loft). Edge radii are
 * clamped so the two bands never overlap and the ring is never inset past its own inradius.
 * An optional relief displaces the straight wall outward (base textures), fading into the edge bands.
 */
function profileLoft(m: ManifoldToplevel, phis: Float64Array, o: ProfileLoft): Manifold {
  const height = Math.max(1, o.height);
  const minIn = Math.min(minInradius(o.section, o.sizeBottom, phis), minInradius(o.section, o.sizeTop, phis));
  let rb = clamp(o.bottomRadius, 0, Math.min(height / 2, minIn * 0.45));
  let rt = clamp(o.topRadius, 0, Math.min(height / 2, minIn * 0.45));
  if (rb + rt > height) {
    const k = height / (rb + rt);
    rb *= k;
    rt *= k;
  }
  const ts: number[] = [];
  if ((o.extendDown ?? 0) > 0) ts.push(-o.extendDown!);
  if (rb > 0.05) {
    for (let j = 0; j <= EDGE_SEGS; j++) ts.push((rb * j) / EDGE_SEGS);
  } else {
    ts.push(0);
  }
  const wallN = Math.max(1, o.relief ? (o.wallRings ?? 1) : 1);
  for (let j = 1; j < wallN; j++) ts.push(rb + ((height - rt - rb) * j) / wallN);
  if (wallN === 1 && height - rt > rb + 0.05) ts.push((rb + height - rt) / 2);
  if (rt > 0.05) {
    for (let j = 0; j <= EDGE_SEGS; j++) {
      const t = height - rt + (rt * j) / EDGE_SEGS;
      if (t > ts[ts.length - 1] + 1e-9) ts.push(t);
    }
  } else if (height > ts[ts.length - 1] + 1e-9) {
    ts.push(height);
  }
  if ((o.extendUp ?? 0) > 0) ts.push(height + o.extendUp!);

  const wallH = Math.max(1e-6, height - rt - rb);
  const rings = ts.map((t) => {
    const f = clamp(t / height, 0, 1);
    const size = o.sizeBottom + (o.sizeTop - o.sizeBottom) * f;
    const inset = t >= 0 && t <= rb ? edgeInset(o.style, rb, t) : t >= height - rt ? edgeInset(o.style, rt, height - t) : 0;
    const ring = ringAt(o.section, size, o.z0 + t, phis, o.twist * f, inset, o.cx ?? 0, o.cy ?? 0);
    if (!o.relief || t <= rb + 1e-6 || t >= height - rt - 1e-6) return ring;
    const v = (t - rb) / wallH;
    const cx = o.cx ?? 0;
    const cy = o.cy ?? 0;
    return ring.map(([x, y, z], k) => {
      const d = o.relief!(phis[k], v);
      const r = Math.hypot(x - cx, y - cy);
      const s = r > 1e-9 ? (r + d) / r : 1;
      return [cx + (x - cx) * s, cy + (y - cy) * s, z] as Vec3;
    });
  });
  return loftSolid(m, rings);
}

/** Tapered round rod from `top` down to `tip`; with `foot`, a domed sphere at the tip (printed leg on the table). */
function legSolid(m: ManifoldToplevel, top: Vec3, tip: Vec3, rTop: number, rTip: number, seg: number, foot: boolean): Manifold {
  const dx = tip[0] - top[0];
  const dy = tip[1] - top[1];
  const dz = tip[2] - top[2];
  const len = Math.hypot(dx, dy, dz);
  // build along +Z from the tip, then tilt to the leg direction (pointing from tip up to top)
  const ux = -dx / len;
  const uy = -dy / len;
  const uz = -dz / len;
  const tilt = Math.acos(clamp(uz, -1, 1)) / DEG;
  const yaw = Math.atan2(uy, ux) / DEG;
  const shaft = m.Manifold.cylinder(len, rTip, rTop, seg);
  const body = foot ? m.Manifold.union([shaft, m.Manifold.sphere(rTip, seg)]) : shaft;
  return body.rotate([0, tilt, 0]).rotate([0, 0, yaw]).translate(tip[0], tip[1], tip[2]);
}

/** Vertical cutting cylinder from zBottom to zTop at (cx, cy). */
function bore(
  m: ManifoldToplevel,
  diameter: number,
  zBottom: number,
  zTop: number,
  cx: number,
  cy: number,
  seg: number,
): Manifold {
  return m.Manifold.cylinder(zTop - zBottom, diameter / 2, -1, seg).translate(cx, cy, zBottom);
}

/** Box with its bottom face centred at (x, y, z0), `along` = unit XY direction of its first side. */
function orientedBlock(
  m: ManifoldToplevel,
  x: number,
  y: number,
  z0: number,
  along: [number, number],
  lenAlong: number,
  lenAcross: number,
  height: number,
): Manifold {
  const yaw = Math.atan2(along[1], along[0]) / DEG;
  return m.Manifold.cube([lenAlong, lenAcross, height], true)
    .translate(0, 0, height / 2)
    .rotate([0, 0, yaw])
    .translate(x, y, z0);
}

/**
 * Splice-connector pocket, open at the base underside: the pocket itself, two crush ribs standing 0.45 mm proud of
 * the end walls (returned as adds: the connector is held by interference, not gravity — the lamp gets lifted), and a
 * wire slot from the pocket into the cord bore.
 */
function wagoPocket(m: ManifoldToplevel, s: WagoSlot, zb: number, axisX: number, axisY: number, slotW: number): { cut: Manifold; ribs: Manifold[] } {
  const across: [number, number] = [-s.along[1], s.along[0]];
  const pocket = orientedBlock(m, s.x, s.y, zb - THROUGH, s.along, s.lenAlong, s.lenAcross, s.depth + THROUGH);
  // wire slot: from the pocket centre to the lamp axis, as tall as the pocket
  const dx = axisX - s.x;
  const dy = axisY - s.y;
  const len = Math.hypot(dx, dy);
  const slot = orientedBlock(m, (s.x + axisX) / 2, (s.y + axisY) / 2, zb - THROUGH, [dx / len, dy / len], len, slotW, s.depth + THROUGH);
  // ribs on the two end walls (the wire slot breaks through the long wall facing the axis)
  const ribs: Manifold[] = [];
  const ribLen = Math.min(6, s.lenAcross * 0.5);
  const ribH = s.depth * 0.6;
  for (const side of [-1, 1]) {
    const off = side * (s.lenAlong / 2 - 0.15);
    ribs.push(orientedBlock(m, s.x + s.along[0] * off, s.y + s.along[1] * off, zb + s.depth - ribH, across, ribLen, 0.6, ribH));
  }
  const cut = m.Manifold.union([pocket, slot]);
  pocket.delete();
  slot.delete();
  return { cut, ribs };
}

/** Outer diameter of a joint spigot built around a `boreDiameter` cord bore. */
function spigotDiameter(boreDiameter: number, j: JointParams): number {
  return boreDiameter + 2 * Math.max(1.2, j.spigotWall);
}

/** Diameter of the matching hole (spigot + diametral clearance). */
function spigotHoleDiameter(boreDiameter: number, j: JointParams): number {
  return spigotDiameter(boreDiameter, j) + Math.max(0.05, j.clearance);
}

/** Resolved internal shape of the cup; the stem's top spigot length depends on it. */
interface CupPlan {
  zBot: number;
  plateBottom: number;
  /** straight bore in the cup bottom (joint socket / cord pass-through) */
  boreD: number;
  /** full cavity diameter above the conical flare */
  cavityD: number;
  /** top of the straight bore */
  zShelf: number;
  /** z where the cavity reaches its full diameter */
  coneEnd: number;
  plateHoleD: number;
  nutPocket: { size: number; height: number } | null;
  /** usable engagement depth for the stem spigot (zShelf − zBot) */
  straightDepth: number;
  notes: string[];
}

function planCup(p: LampParams, layout: Layout, cordD: number, stemBoreD: number, phis: Float64Array): CupPlan {
  const cu = p.cup;
  const hw = p.hardware;
  const st = p.stem;
  const notes: string[] = [];
  const zBot = layout.stemTop;
  const hasStem = st.height > 0;
  const cupSpigot = st.cupJoint.kind === 'spigot';
  const plateT = clamp(cu.plateThickness, 1, Math.max(1, cu.height * 0.5));
  const plateBottom = layout.cupTop - plateT;
  // The cup bottom bore either receives the stem's spigot, or is the cord bore
  // (when the cup itself carries the spigot, or the joint is fused).
  const boreD = cupSpigot
    ? hasStem
      ? spigotHoleDiameter(stemBoreD, st.cupJoint)
      : cordD
    : Math.max(stemBoreD, cordD);

  let cavityD: number;
  let zShelf: number;
  let coneEnd: number;
  let plateHoleD: number;
  let nutPocket: CupPlan['nutPocket'] = null;

  if (hw.socketMount === 'ring') {
    const need = hw.socket.bodyDiameter + cu.clearance;
    cavityD = cu.cavityDiameter > 0 ? cu.cavityDiameter : need;
    if (cavityD < need - 1e-6)
      notes.push(
        `Cavity Ø${r1(cavityD)} mm is smaller than the socket body + clearance (Ø${r1(need)} mm) — the socket may not fit.`,
      );
    const gap = Math.max(4, hw.cordThickness + 2);
    zShelf = clamp(layout.socketBottom - gap, zBot + 3, plateBottom - 2);
    coneEnd = Math.min(layout.socketBottom - 1, plateBottom);
    // The socket is dropped in from above, so the plate hole must pass the body, not just the skirt.
    plateHoleD = Math.max(layout.hubHoleDiameter, hw.socket.bodyDiameter + cu.clearance + 0.4);
    if (plateHoleD > layout.hubHoleDiameter + 1e-6)
      notes.push(
        `Plate hole opened to Ø${r1(plateHoleD)} mm so the socket drops in from above; the shade ring still clamps on the skirt.`,
      );
  } else if (hw.socketMount === 'snap') {
    // The body hangs below the plate and the wings spring out underneath it: the cavity clears both.
    const need = Math.max(hw.socket.bodyDiameter, hw.socket.clipReach) + cu.clearance;
    cavityD = cu.cavityDiameter > 0 ? cu.cavityDiameter : need;
    if (cavityD < need - 1e-6)
      notes.push(
        `Cavity Ø${r1(cavityD)} mm is smaller than the socket body / clip wings + clearance (Ø${r1(need)} mm) — the socket may not fit.`,
      );
    const gap = Math.max(4, hw.cordThickness + 2);
    zShelf = clamp(layout.socketBottom - gap, zBot + 3, plateBottom - 2);
    coneEnd = Math.min(layout.socketBottom - 1, plateBottom);
    plateHoleD = hw.socket.snapHoleDiameter + cu.clearance;
  } else {
    const nutAcrossCorners = hw.nutAcrossFlats / Math.cos(Math.PI / 6);
    const pocketH = hw.nutThickness + 1;
    nutPocket = { size: (hw.nutAcrossFlats + cu.clearance) / Math.cos(Math.PI / 6), height: pocketH };
    cavityD =
      cu.cavityDiameter > 0
        ? Math.max(cu.cavityDiameter, nutAcrossCorners + 1.2)
        : Math.max(boreD, nutAcrossCorners + 4);
    if (cavityD - nutPocket.size < 2)
      notes.push(`Nut pocket leaves only ${r1((cavityD - nutPocket.size) / 2)} mm of wall around it.`);
    zShelf = clamp(
      zBot + (cupSpigot ? st.cupJoint.spigotLength + 1.5 : 5),
      zBot + 3,
      plateBottom - pocketH - 2.5,
    );
    coneEnd = plateBottom - pocketH - 0.5;
    plateHoleD = hw.nippleDiameter + cu.clearance;
  }

  const wallMin = 1.8;
  const maxCav =
    2 * Math.min(minInradius(cu.section, cu.size, phis), minInradius(cu.section, cu.size * cu.topScale, phis)) -
    2 * wallMin;
  if (cavityD > maxCav) {
    cavityD = Math.max(maxCav, boreD);
    notes.push(`Cavity clamped to Ø${r1(cavityD)} mm to keep a ≥${wallMin} mm wall.`);
  }
  if (coneEnd <= zShelf + 0.3) {
    // Not enough room for the flare — run one straight bore and let the note explain the fit.
    coneEnd = zShelf;
    cavityD = Math.max(cavityD, boreD);
  } else if (cavityD > boreD + 0.3) {
    const slope = Math.atan2(cavityD / 2 - boreD / 2, coneEnd - zShelf) / DEG;
    if (slope > 45)
      notes.push(
        `Cavity flare is steep (${r1(slope)}° from vertical) — expect a small bridged ring when printing plate-down.`,
      );
  }
  return {
    zBot,
    plateBottom,
    boreD,
    cavityD,
    zShelf,
    coneEnd,
    plateHoleD,
    nutPocket,
    straightDepth: zShelf - zBot,
    notes,
  };
}

/**
 * Base: profile-swept loft with rounded/chamfered edges and optional surface texture; solid (weight pocket,
 * felt-pad recesses, cord channel underneath) or hollow (open underneath, 45° self-supporting roof, cord
 * notch in the rim); optional splayed legs; and the shade seat — a groove ('base') or a raised lip ('lip').
 */
function buildBaseSolid(
  m: ManifoldToplevel,
  p: LampParams,
  layout: Layout,
  phis: Float64Array,
  seg: number,
  hole: { diameter: number; depth: number } | null,
  notes: string[],
): Manifold {
  const b = p.base;
  const hw = p.hardware;
  const zb = layout.baseBottom;
  const legged = b.legs >= 3;
  const hollow = b.shellWall > 0;
  const texture = textureField(b.texture);
  const texRows = textureSampling(b.texture).along;
  const textured = b.texture.pattern !== 'none' && b.texture.depth > 0;
  // texture needs denser angular sampling than the plain loft
  const tphis = textured ? angles(Math.max(phis.length, textureSampling(b.texture).around)) : phis;
  let solid = profileLoft(m, tphis, {
    section: b.section,
    sizeBottom: b.size,
    sizeTop: b.size * b.topScale,
    twist: b.twist,
    z0: zb,
    height: b.height,
    style: b.edgeStyle,
    bottomRadius: b.bottomEdgeRadius,
    topRadius: b.topEdgeRadius,
    relief: textured ? texture : undefined,
    wallRings: texRows,
  });
  const tools: Manifold[] = [];
  const adds: Manifold[] = [];

  if (hollow) {
    // Inner cavity: section inset by the shell wall, open at the bottom. The roof is flat with a 45° chamfer
    // around the perimeter (≤ 8 mm), so it prints as a short bridge from the boss outward without supports;
    // the roof keeps `shellWall` thickness under the base top.
    const wall = b.shellWall;
    const inR: number[] = Array.from(phis, (phi) => {
      const rb = sectionRadius(b.section, phi) * b.size;
      const rt = sectionRadius(b.section, phi - b.twist * DEG) * b.size * b.topScale;
      return Math.max(1, Math.min(rb, rt) - wall - Math.max(b.bottomEdgeRadius, b.topEdgeRadius) * 0.3);
    });
    const roofTop = zb + b.height - wall;
    const chamfer = Math.min(8, Math.max(0, roofTop - zb - 1), Math.min(...inR) - 1);
    const zs = [zb - THROUGH, roofTop - chamfer, roofTop];
    const rings = zs.map((z, j) =>
      inR.map((r, i) => {
        const rr = j < 2 ? r : Math.max(0.5, r - chamfer);
        return [rr * Math.cos(phis[i]), rr * Math.sin(phis[i]), z] as Vec3;
      }),
    );
    // Solid boss on the lamp axis, floor to roof: carries the stem/cup spigot hole and the cord bore,
    // and shortens the roof bridge.
    const bossR = Math.max(hole ? hole.diameter / 2 : 0, cordBoreDiameter(hw) / 2) + 3;
    const boss = bore(m, 2 * bossR, zb - 2 * THROUGH, zb + b.height, layout.axisX, layout.axisY, seg);
    tools.push(loftSolid(m, rings).subtract(boss));
    boss.delete();
    const span = Math.max(...inR) - chamfer - bossR;
    notes.push(
      `Hollow shell, ${r1(wall)} mm wall, open underneath; flat roof bridges ${r1(span)} mm from the central boss${span > 40 ? ' — print upright with supports, or flipped (top on the bed)' : ''}.`,
    );
  } else if (!legged && b.weightPocketDiameter > 0 && b.weightPocketDepth > 0) {
    const depth = Math.min(b.weightPocketDepth, b.height * 0.7);
    const diameter = Math.min(b.weightPocketDiameter, 2 * Math.max(2, minInradius(b.section, b.size, phis) - 3));
    tools.push(bore(m, diameter, zb - THROUGH, zb + depth, 0, 0, seg));
    const grams = Math.round((Math.PI * (diameter / 2) ** 2 * depth * 1.6) / 1000);
    notes.push(`Weight pocket Ø${r1(diameter)} × ${r1(depth)} mm — about ${grams} g of sand or steel shot.`);
  }

  if (!legged && !hollow && b.feetCount > 0 && b.feetDiameter > 0 && b.feetDepth > 0) {
    const exit = b.cordExitAngle;
    let placed = 0;
    for (let i = 0; i < b.feetCount; i++) {
      const a = (i / b.feetCount) * TAU;
      const dAngle = Math.abs(((a / DEG - exit + 540) % 360) - 180);
      if (dAngle < 20) continue; // keep the pad recesses clear of the cord channel
      const rEdge = sectionRadius(b.section, a) * b.size;
      const rc = Math.max(0, rEdge - b.feetInset);
      tools.push(bore(m, b.feetDiameter, zb - THROUGH, zb + b.feetDepth, Math.cos(a) * rc, Math.sin(a) * rc, seg));
      placed++;
    }
    if (placed > 0)
      notes.push(`Felt pads: ${placed} × Ø${r1(b.feetDiameter)} mm, ${r1(b.feetDepth)} mm recesses under the base.`);
  }

  // Vertical cord bore on the lamp axis, meeting the channel underneath and the stem/cup above.
  tools.push(bore(m, cordBoreDiameter(hw), zb - THROUGH, layout.baseTop + THROUGH, layout.axisX, layout.axisY, seg));

  if (b.cordChannel && !legged) {
    const w = (hw.prewiredCord ? hw.plugWidth : hw.cordWidth) + 2 * CORD_CLEAR;
    let h = (hw.prewiredCord ? hw.plugThickness : hw.cordThickness) + 2 * CORD_CLEAR;
    if (!hollow && h > b.height - 0.5) {
      h = b.height - 0.5;
      notes.push('Cord channel breaks through the base top — raise the base or use a detachable cord.');
    }
    const exit = b.cordExitAngle * DEG;
    const dir: [number, number] = [Math.cos(exit), Math.sin(exit)];
    const perp: [number, number] = [-dir[1], dir[0]];
    const rEdge = Math.max(
      sectionRadius(b.section, exit) * b.size,
      sectionRadius(b.section, exit - b.twist * DEG) * b.size * b.topScale,
    ) + b.texture.depth;
    // hollow: only a notch through the rim wall; solid: a full channel from the axis
    const s0 = hollow ? rEdge - b.shellWall - 4 : -w * 0.5;
    const s1 = rEdge + 2;
    const N = hollow ? 2 : 10;
    const rings: Vec3[][] = [];
    for (let j = 0; j <= N; j++) {
      const s = s0 + ((s1 - s0) * j) / N;
      const px = (hollow ? 0 : layout.axisX) + dir[0] * s;
      const py = (hollow ? 0 : layout.axisY) + dir[1] * s;
      rings.push([
        [px + perp[0] * (w / 2), py + perp[1] * (w / 2), zb - THROUGH],
        [px - perp[0] * (w / 2), py - perp[1] * (w / 2), zb - THROUGH],
        [px - perp[0] * (w / 2), py - perp[1] * (w / 2), zb + h],
        [px + perp[0] * (w / 2), py + perp[1] * (w / 2), zb + h],
      ]);
    }
    tools.push(loftSolid(m, rings));
    if (hw.prewiredCord)
      notes.push(`Cord route sized for the moulded plug (${r1(hw.plugWidth)} × ${r1(hw.plugThickness)} mm).`);
  }

  // Legs / dowel sleeves are unioned after the cavity cut (below) so a hollow base keeps solid roots.
  const legs: Manifold[] = [];
  const legTools: Manifold[] = [];
  if (legged) {
    const count = layout.legs.length;
    const legSeg = Math.max(24, Math.min(seg, 48));
    if (b.legKind === 'dowel') {
      const rBore = (b.dowelDiameter + b.dowelClearance) / 2;
      const rSleeve = rBore + Math.max(0.8, b.dowelSleeveWall);
      const zTop = layout.legs[0].top[2];
      let cutLength = 0;
      let tilt = 0;
      let insertion = 0;
      for (const { top, tip } of layout.legs) {
        const axisLen = Math.hypot(top[0] - tip[0], top[1] - tip[1], top[2] - tip[2]);
        const cosT = (top[2] - tip[2]) / axisLen;
        tilt = Math.acos(clamp(cosT, -1, 1));
        // A square-cut dowel end stops where its highest rim point meets the flat socket floor at zTop,
        // rD·tanθ along the axis below the top point.
        const endInset = (b.dowelDiameter / 2) * Math.tan(tilt);
        // the sleeve reaches the requested insertion depth, and its whole mouth (the rim tilted up by
        // rSleeve·tanθ) clears the base underside by ≥ 2 mm
        const exitLen = (top[2] - zb) / Math.max(1e-6, cosT) + rSleeve * Math.tan(tilt) + 2;
        const sleeveLen = Math.max(b.dowelSocketDepth + endInset, exitLen);
        insertion = sleeveLen - endInset;
        cutLength = axisLen - endInset;
        // point `len` mm down the axis from `top`
        const at = (len: number): Vec3 => {
          const f = len / axisLen;
          return [top[0] + (tip[0] - top[0]) * f, top[1] + (tip[1] - top[1]) * f, top[2] + (tip[2] - top[2]) * f];
        };
        // overshoot above `top` so trimming at zTop leaves a flat socket floor
        const over = rSleeve * Math.tan(tilt) + 1;
        const sleeve = legSolid(m, at(-over), at(sleeveLen), rSleeve, rSleeve, legSeg, false);
        const boreTool = legSolid(m, at(-over), at(sleeveLen + 20), rBore, rBore, legSeg, false);
        legs.push(sleeve.trimByPlane([0, 0, -1], -zTop));
        legTools.push(boreTool.trimByPlane([0, 0, -1], -zTop));
        sleeve.delete();
        boreTool.delete();
      }
      const centreR = Math.max(hole ? hole.diameter / 2 : 0, cordBoreDiameter(hw) / 2);
      const rootR = Math.hypot(layout.legs[0].top[0], layout.legs[0].top[1]);
      if (rootR - rBore / Math.cos(tilt) < centreR + 1.2)
        notes.push('Dowel sockets break into the centre bore — increase the leg root radius or use thinner dowels.');
      notes.push(
        `${count} dowel sockets Ø${r1(2 * rBore)} mm (Ø${r1(b.dowelDiameter)} ${b.dowelMaterial} dowel + ${r1(b.dowelClearance)} mm clearance), ` +
          `${r1(insertion)} mm insertion, ${r1(b.dowelSleeveWall)} mm sleeve wall, ${r1(tilt / DEG)}° from vertical. ` +
          `Cut ${count} dowels ${r1(cutLength)} mm long on the centreline: top square, foot mitred ${r1(tilt / DEG)}° so it sits flat. ` +
          'Prints upside down (base top on the bed); the cord drops from the base centre between the legs.',
      );
    } else {
      for (const { top, tip } of layout.legs) legs.push(legSolid(m, top, tip, b.legDiameter / 2, b.legTipDiameter / 2, legSeg, true));
      notes.push(
        `${count} legs, ${r1(b.legDiameter)}→${r1(b.legTipDiameter)} mm, ${r1(b.legSpread)} mm spread. Prints upside down (base top on the bed); the cord drops from the base centre between the legs.`,
      );
    }
  }

  if (p.shade.mount === 'base' || p.shade.mount === 'lip') {
    const c = p.shade.baseGrooveClearance;
    const outerR: number[] = [];
    const innerR: number[] = [];
    for (let i = 0; i < phis.length; i++) {
      const rOut = layout.shade.outerRadius(0, phis[i]);
      const rIn = layout.shade.innerRadius(0, phis[i]);
      if (p.shade.mount === 'base') {
        outerR.push(rOut + c);
        innerR.push(Math.max(0, Math.min(rIn - c, rOut + c - 0.4)));
      } else {
        // lip: raised ring inside the shade bottom; wall 2.4 mm, outer face = shade inner wall − clearance
        const ro = Math.max(1, rIn - c);
        outerR.push(ro);
        innerR.push(Math.max(0.5, ro - 2.4));
      }
    }
    const ringOf = (radii: number[], z: number): Vec3[] =>
      radii.map((r, i) => [r * Math.cos(phis[i]), r * Math.sin(phis[i]), z] as Vec3);
    if (p.shade.mount === 'base') {
      const zs = [layout.shadeBottom, layout.baseTop + THROUGH];
      tools.push(loftTube(m, zs.map((z) => ringOf(outerR, z)), zs.map((z) => ringOf(innerR, z))));
      notes.push(`Shade seats in the base groove (${r1(2 * c)} mm diametral clearance, ${r1(p.shade.baseGrooveDepth)} mm deep).`);
    } else {
      // lip from slightly inside the base top (solid union) up by the lip height, with a 0.8 mm lead-in chamfer
      const zLo = layout.baseTop - 0.5;
      const zHi = layout.baseTop + p.shade.baseGrooveDepth;
      const zs = [zLo, zHi - 0.8, zHi];
      const outs = [ringOf(outerR, zs[0]), ringOf(outerR, zs[1]), ringOf(outerR.map((r) => r - 0.8), zs[2])];
      const ins = zs.map((z) => ringOf(innerR, z));
      adds.push(loftTube(m, outs, ins));
      notes.push(`Shade sleeves over a ${r1(p.shade.baseGrooveDepth)} mm lip (${r1(2 * c)} mm diametral clearance) — outer surfaces sit flush.`);
    }
  }

  if (adds.length) solid = m.Manifold.union([solid, ...adds]);

  if (hole) {
    tools.push(
      bore(m, hole.diameter, layout.baseTop - hole.depth, layout.baseTop + 0.05, layout.axisX, layout.axisY, seg),
    );
  }

  for (const t of tools) {
    solid = solid.subtract(t);
    t.delete();
  }
  if (legs.length) {
    solid = m.Manifold.union([solid, ...legs]);
    // dowel bores, and the cord path + joint hole through the base kept clear of the leg roots
    legTools.push(bore(m, cordBoreDiameter(hw), zb - THROUGH, layout.baseTop + THROUGH, layout.axisX, layout.axisY, seg));
    if (hole)
      legTools.push(bore(m, hole.diameter, layout.baseTop - hole.depth, layout.baseTop + 0.05, layout.axisX, layout.axisY, seg));
    for (const t of legTools) {
      solid = solid.subtract(t);
      t.delete();
    }
  }
  if (layout.wagos.length && !hollow) {
    const w = hw.wago;
    const info = WAGO_CONNECTORS[w.model];
    const slotW = Math.min(layout.wagos[0].lenAcross - 2, Math.max(4, 2 * hw.cordThickness));
    const ribs: Manifold[] = [];
    for (const s of layout.wagos) {
      const pocket = wagoPocket(m, s, zb, layout.axisX, layout.axisY, slotW);
      solid = solid.subtract(pocket.cut);
      pocket.cut.delete();
      ribs.push(...pocket.ribs);
    }
    solid = m.Manifold.union([solid, ...ribs]);
    const s0 = layout.wagos[0];
    notes.push(
      `2 × ${w.model} pockets under the base (${r1(s0.lenAlong)} × ${r1(s0.lenAcross)} × ${r1(s0.depth)} mm incl. ${r1(w.clearance)} mm/side), ` +
        `${s0.standing ? 'connector stands wire-entries down' : 'connector lies flat, levers down'}, with crush ribs and a wire slot to the cord bore. ` +
        `One connector per conductor (cord ridged/neutral → socket silver/neutral; smooth/hot → brass/hot). Strip ${info.strip} mm; push in until the wires bottom out.`,
    );
    if (w.model === '2273-202')
      notes.push('2273-202 is rated for SOLID wire only — cord-set and socket leads are stranded: use 221-412 lever-nuts instead.');
  }
  return solid;
}

/** Cup: outer loft with rounded top edge, cavity + conical flare under the top plate, plate hole,
 *  nut pocket (nipple mode) and the joint feature in the bottom bore. */
function buildCupSolid(
  m: ManifoldToplevel,
  p: LampParams,
  layout: Layout,
  phis: Float64Array,
  seg: number,
  plan: CupPlan,
  cupSpigotLength: number,
  cordD: number,
): Manifold {
  const cu = p.cup;
  const st = p.stem;
  const cx = layout.axisX;
  const cy = layout.axisY;
  const fusedToBase = st.height <= 0 && st.cupJoint.kind === 'fused';
  const plateT = layout.cupTop - plan.plateBottom;

  let solid = profileLoft(m, phis, {
    section: cu.section,
    sizeBottom: cu.size,
    sizeTop: cu.size * cu.topScale,
    twist: 0,
    z0: plan.zBot,
    height: cu.height,
    style: 'fillet',
    bottomRadius: 0,
    topRadius: Math.min(cu.edgeRadius, plateT),
    cx,
    cy,
    extendDown: fusedToBase ? FUSE_EMBED : 0,
  });

  const rBore = plan.boreD / 2;
  const rCav = Math.max(plan.cavityD, plan.boreD) / 2;
  const profile: Array<[number, number]> = [
    [plan.zBot - THROUGH, rBore],
    [plan.zBot, rBore],
  ];
  if (plan.coneEnd > plan.zShelf + 0.3 && rCav > rBore + 0.3) {
    profile.push([plan.zShelf, rBore]);
    for (let j = 1; j <= CONE_SEGS; j++) {
      const f = j / CONE_SEGS;
      profile.push([plan.zShelf + (plan.coneEnd - plan.zShelf) * f, rBore + (rCav - rBore) * f]);
    }
    profile.push([plan.plateBottom, rCav]);
  } else {
    profile.push([plan.plateBottom, Math.max(rCav, rBore)]);
  }
  solid = solid.subtract(
    loftSolid(m, profile.map(([z, r]) => ringAt(circleSection, r * 2, z, phis, 0, 0, cx, cy))),
  );

  // Top-plate hole: skirt (ring mode) or nipple.
  const plateHole = bore(m, plan.plateHoleD, plan.plateBottom - THROUGH, layout.cupTop + THROUGH, cx, cy, seg);
  solid = solid.subtract(plateHole);
  plateHole.delete();

  if (plan.nutPocket) {
    const np = plan.nutPocket;
    const rings = [plan.plateBottom - np.height, plan.plateBottom + 0.15].map((z) =>
      ringAt(hexSection, np.size, z, phis, 0, 0, cx, cy),
    );
    const pocket = loftSolid(m, rings);
    solid = solid.subtract(pocket);
    pocket.delete();
  }

  // No stem: the cupJoint spigot is carried by the cup and seats in the base.
  if (st.height <= 0 && st.cupJoint.kind === 'spigot' && cupSpigotLength > 0) {
    const dOut = spigotDiameter(cordD, st.cupJoint);
    solid = solid.add(m.Manifold.cylinder(cupSpigotLength, dOut / 2, -1, seg).translate(cx, cy, plan.zBot - cupSpigotLength));
    const cordBore = bore(m, cordD, plan.zBot - cupSpigotLength - THROUGH, plan.zBot + THROUGH, cx, cy, seg);
    solid = solid.subtract(cordBore);
    cordBore.delete();
  }
  return solid;
}

/** True when the stem's bottom ring fits inside the base's top ring (both sections are convex). */
function stemOutsideBaseTop(p: LampParams, layout: Layout, phis: Float64Array): boolean {
  const st = p.stem;
  const b = p.base;
  const topSize = b.size * b.topScale;
  const twistTop = b.twist * DEG;
  const ring = sectionRing(st.section, st.size, phis, 0);
  for (let i = 0; i < ring.length; i++) {
    const x = ring[i][0] + layout.axisX;
    const y = ring[i][1] + layout.axisY;
    const phi = Math.atan2(y, x);
    if (Math.hypot(x, y) > sectionRadius(b.section, phi - twistTop) * topSize - 0.05) return true;
  }
  return false;
}

/**
 * Base, stem and cup solids in assembled world coordinates. Fused joints merge bodies into the
 * lower part ('Base + stem', 'Stem + cup', 'Base + stem + cup'); spigot joints keep separate
 * parts with a press-fit spigot on the stem end and a matching hole in the mating part.
 */
export function buildStructure(m: ManifoldToplevel, p: LampParams, layout: Layout): SolidPart[] {
  const phis = angles(p.quality.radialSegments);
  const seg = clamp(p.quality.radialSegments, 32, 128);
  const st = p.stem;
  const hw = p.hardware;
  const hasStem = st.height > 0;
  const baseFused = st.baseJoint.kind === 'fused';
  const cupFused = st.cupJoint.kind === 'fused';

  const cordD = cordBoreDiameter(hw);
  const stemNotes: string[] = [];
  let stemBoreD = cordD;
  if (hasStem) {
    stemBoreD = Math.max(st.boreDiameter, cordD);
    const maxBore = st.size - 3;
    if (stemBoreD > maxBore) {
      stemBoreD = maxBore;
      stemNotes.push(
        `Stem bore limited to Ø${r1(stemBoreD)} mm by the stem diameter — a prewired plug will not pass; use a detachable cord or a wider stem.`,
      );
    }
  }

  const cupPlan = planCup(p, layout, cordD, stemBoreD, phis);
  const cupNotes = [...cupPlan.notes];

  // Effective spigot engagement lengths, clamped to what the mating part can host.
  let topSpigot = 0;
  if (hasStem && !cupFused) {
    topSpigot = clamp(st.cupJoint.spigotLength, 2, Math.max(2, cupPlan.straightDepth - 0.4));
    if (topSpigot < st.cupJoint.spigotLength - 1e-6)
      stemNotes.push(
        `Cup-joint spigot engagement limited to ${r1(topSpigot)} mm by the cup cavity — lengthen the cup or shorten the spigot.`,
      );
  }
  let baseSpigot = 0;
  if (hasStem && !baseFused) {
    baseSpigot = clamp(st.baseJoint.spigotLength, 2, Math.max(2, layout.baseTop - 2.5));
    if (baseSpigot < st.baseJoint.spigotLength - 1e-6)
      stemNotes.push(
        `Base-joint spigot engagement limited to ${r1(baseSpigot)} mm by the base height — lengthen the base or shorten the spigot.`,
      );
  }
  let cupDownSpigot = 0;
  if (!hasStem && !cupFused) {
    cupDownSpigot = clamp(st.cupJoint.spigotLength, 2, Math.max(2, layout.baseTop - 2.5));
    if (cupDownSpigot < st.cupJoint.spigotLength - 1e-6)
      cupNotes.push(
        `Cup spigot engagement limited to ${r1(cupDownSpigot)} mm by the base height — lengthen the base or shorten the spigot.`,
      );
  }

  const baseNotes: string[] = [];
  const baseHole = hasStem
    ? baseFused
      ? null
      : { diameter: spigotHoleDiameter(stemBoreD, st.baseJoint), depth: baseSpigot + 0.5 }
    : cupFused
      ? null
      : { diameter: spigotHoleDiameter(cordD, st.cupJoint), depth: cupDownSpigot + 0.5 };
  let baseSolid = buildBaseSolid(m, p, layout, phis, seg, baseHole, baseNotes);

  let stemSolid: Manifold | null = null;
  if (hasStem) {
    const cx = layout.axisX;
    const cy = layout.axisY;
    stemSolid = profileLoft(m, phis, {
      section: st.section,
      sizeBottom: st.size,
      sizeTop: st.size * st.topScale,
      twist: st.twist,
      z0: layout.baseTop,
      height: st.height,
      style: 'fillet',
      bottomRadius: 0,
      topRadius: 0,
      cx,
      cy,
      extendDown: baseFused ? FUSE_EMBED : 0,
      extendUp: cupFused ? FUSE_EMBED : 0,
    });
    if (baseSpigot > 0) {
      const dOut = spigotDiameter(stemBoreD, st.baseJoint);
      const spigot = m.Manifold.cylinder(baseSpigot, dOut / 2, -1, seg).translate(cx, cy, layout.baseTop);
      stemSolid = stemSolid.add(spigot);
      spigot.delete();
    }
    if (topSpigot > 0) {
      const dOut = spigotDiameter(stemBoreD, st.cupJoint);
      const spigot = m.Manifold.cylinder(topSpigot, dOut / 2, -1, seg).translate(cx, cy, layout.stemTop);
      stemSolid = stemSolid.add(spigot);
      spigot.delete();
    }
    const zBotBore = layout.baseTop - (baseFused ? FUSE_EMBED : baseSpigot) - THROUGH;
    const zTopBore = layout.stemTop + (cupFused ? FUSE_EMBED : topSpigot) + THROUGH;
    const boreTool = bore(m, stemBoreD, zBotBore, zTopBore, cx, cy, seg);
    stemSolid = stemSolid.subtract(boreTool);
    boreTool.delete();
    if (stemOutsideBaseTop(p, layout, phis))
      stemNotes.push('Stem footprint reaches past the base top — widen the base or narrow the stem.');
  }

  const cupSolid = buildCupSolid(m, p, layout, phis, seg, cupPlan, cupDownSpigot, cordD);
  if (hw.socketMount === 'ring') {
    cupNotes.push(
      `Socket drops in from above; Ø${r1(hw.socket.ringDiameter)} mm shade ring clamps it on the plate.`,
    );
  } else if (hw.socketMount === 'snap') {
    const grip = layout.cupTop - cupPlan.plateBottom + layout.hubThickness;
    cupNotes.push(
      `Snap-in socket: Ø${r1(cupPlan.plateHoleD)} mm hole; the clip wings grip ${r1(grip)} mm of plate${layout.hubThickness > 0 ? ' + hub' : ''} ` +
        `(rated ${r1(hw.socket.gripMin)}–${r1(hw.socket.gripMax)} mm). Wire the socket leads to the cord first (splice connectors), then push the socket in from above until both wings click.`,
    );
  } else {
    const plateT = layout.cupTop - cupPlan.plateBottom;
    const nippleLen = Math.ceil(plateT + hw.nutThickness + 12);
    cupNotes.push(
      `1/8 IPS hollow nipple ≥ ${nippleLen} mm + hex nut ${r1(hw.nutAcrossFlats)} mm AF — nut goes into the hex pocket first; cord threads through the nipple.`,
    );
  }
  cupNotes.push('Prints upside down (top plate on the bed).');

  const parts: SolidPart[] = [];
  const emit = (
    id: 'base' | 'stem' | 'cup',
    label: string,
    solid: Manifold,
    printFlip: boolean,
    notes: string[],
  ) => {
    parts.push({ id, label, solid, printFlip, notes });
  };

  if (cupFused) {
    if (hasStem) {
      stemSolid = stemSolid!.add(cupSolid);
      if (baseFused) {
        baseSolid = baseSolid.add(stemSolid);
        emit('base', 'Base + stem + cup', baseSolid, false, [
          ...baseNotes,
          ...stemNotes,
          ...cupNotes.filter((n) => !n.startsWith('Prints upside down')),
          'Prints upright — fused joints cannot be flipped.',
        ]);
      } else {
        emit('stem', 'Stem + cup', stemSolid, false, [
          ...stemNotes,
          ...cupNotes.filter((n) => !n.startsWith('Prints upside down')),
          'Prints with the spigot on the bed; the cup cavity prints as an open tube.',
        ]);
      }
    } else {
      baseSolid = baseSolid.add(cupSolid);
      emit('base', 'Base + cup', baseSolid, false, [
        ...baseNotes,
        ...cupNotes.filter((n) => !n.startsWith('Prints upside down')),
        'Prints upright — fused joints cannot be flipped.',
      ]);
    }
  } else {
    if (hasStem && baseFused) {
      baseSolid = baseSolid.add(stemSolid!);
      emit('base', 'Base + stem', baseSolid, false, [
        ...baseNotes,
        ...stemNotes,
        'Prints upright — fused joints cannot be flipped.',
      ]);
    } else if (hasStem) {
      emit('base', 'Base', baseSolid, false, baseNotes);
      emit('stem', 'Stem', stemSolid!, false, stemNotes);
    } else {
      // Legs splay downward: print a legged base top-down unless a raised lip sits on top.
      const flip = p.base.legs >= 3 && p.shade.mount !== 'lip';
      emit('base', 'Base', baseSolid, flip, flip ? baseNotes : baseNotes.map((n) => n.replace('Prints upside down (base top on the bed)', 'Prints upright with supports under the leg roots (the lip sits on top)')));
    }
    emit('cup', 'Socket cup', cupSolid, true, cupNotes);
  }
  return parts;
}
