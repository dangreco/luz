import type { LampBuild, PartMesh } from '../geometry/build';
import type { Vec3 } from '../geometry/mesh';
import {
  BULB_SHAPES,
  BULB_TECH,
  DOWEL_MATERIALS,
  MATERIALS,
  UL153_CLOSED_CLOSED,
  UL153_CLOSED_OPEN,
  UL153_OPEN_CLOSED,
  UL153_OPEN_OPEN,
  UL153_OPENING_AREA,
  UL153_SOURCE,
  UL153_STABILITY_DEG,
} from '../model/hardware';
import { shadeBulbClearance, type Layout } from '../model/layout';
import type { LampParams } from '../model/params';
import { angles, sectionRing, type Vec2 } from '../model/section';
import type { ShadeSurface } from '../model/shadeSurface';

export interface SafetyCheck {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  detail: string;
  source?: string;
}

type Status = SafetyCheck['status'];

/** Angular sampling for area / distance scans (fixed so results are deterministic). */
const AREA_STEPS = 128;
const PHI_STEPS = 72;

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

/** Mean radius (mm) of the nominal inner wall at height fraction t. */
function meanInner(shade: ShadeSurface, t: number): number {
  let sum = 0;
  for (let i = 0; i < PHI_STEPS; i++) sum += shade.innerRadius(t, (i / PHI_STEPS) * Math.PI * 2);
  return sum / PHI_STEPS;
}

/** Smallest inner-wall radius (mm) at height fraction t — the conservative distance from the axis. */
function minInner(shade: ShadeSurface, t: number): number {
  let min = Infinity;
  for (let i = 0; i < PHI_STEPS; i++) min = Math.min(min, shade.innerRadius(t, (i / PHI_STEPS) * Math.PI * 2));
  return min;
}

/** Area (cm²) enclosed by the nominal inner rim at height fraction t (polar shoelace; sections are star-shaped). */
function rimAreaCm2(shade: ShadeSurface, t: number): number {
  const dphi = (Math.PI * 2) / AREA_STEPS;
  let a = 0;
  for (let i = 0; i < AREA_STEPS; i++) {
    a += shade.innerRadius(t, i * dphi) * shade.innerRadius(t, (i + 1) * dphi) * Math.sin(dphi);
  }
  return (a * 0.5) / 100;
}

/** Volume-weighted centroid of the bulb envelope (mm, world frame). */
function bulbCentroid(layout: Layout): { x: number; y: number; z: number } {
  let w = 0;
  let wz = 0;
  const prof = layout.bulbProfile;
  for (let i = 0; i < prof.length - 1; i++) {
    const [z0, r0] = prof[i];
    const [z1, r1] = prof[i + 1];
    const dz = z1 - z0;
    if (dz <= 0) continue;
    const wi = ((r0 + r1) / 2) ** 2 * dz; // ∝ disc volume of the frustum slice
    w += wi;
    wz += wi * ((z0 + z1) / 2);
  }
  return { x: layout.axisX, y: layout.axisY, z: w > 0 ? wz / w : layout.contactZ };
}

/**
 * Checks that need only the parameters and the resolved layout (no meshes): socket/bulb, UL 153
 * designation and spacing, thermal screening, and stack problems. Cheap enough to screen many candidates.
 */
export function layoutChecks(p: LampParams, layout: Layout): SafetyCheck[] {
  const out: SafetyCheck[] = [socketBulbCheck(p)];
  const d = designate(p, layout);
  out.push(designationCheck(p, d));
  out.push(spacingCheck(p, layout, d));
  out.push(clearanceInfo(layout));
  out.push(thermalShadeCheck(p, layout, d));
  out.push(thermalSocketCheck(p));
  layout.issues.forEach((msg, i) =>
    out.push({
      id: `layout-${i + 1}`,
      title: 'Layout problem',
      status: 'fail',
      detail: msg,
      source: 'Vertical stack rules (computeLayout)',
    }),
  );
  return out;
}

export function runChecks(p: LampParams, build: LampBuild): SafetyCheck[] {
  const out = layoutChecks(p, build.layout);
  out.push(stabilityCheck(p, build));
  out.push(...printChecks(p, build));
  out.push({
    id: 'disclaimer',
    title: 'Not a certification',
    status: 'info',
    detail:
      'These checks are engineering guidance, not a certification or listing. Use a cUL/CSA-listed cord ' +
      'set and socket, and never print electrical parts. An LED bulb is strongly recommended under a printed ' +
      'shade (less heat than incandescent). Do not exceed the marked wattage, and re-check after any change.',
    source: UL153_SOURCE,
  });
  return out;
}

/* -------------------------------------------------------------------------------------------------
 * 1. Socket / bulb compatibility
 * ----------------------------------------------------------------------------------------------- */

function socketBulbCheck(p: LampParams): SafetyCheck {
  const lines: string[] = [];
  let status: Status = 'pass';
  const shape = BULB_SHAPES.find((b) => b.id === p.bulb.shape);
  if (!shape) {
    status = 'fail';
    lines.push(`Bulb shape "${p.bulb.shape}" is not in the catalogue.`);
  } else if (shape.base !== p.hardware.socketBase) {
    status = 'fail';
    lines.push(`${shape.id} is an ${shape.base} bulb but the socket is ${p.hardware.socketBase}.`);
  } else {
    lines.push(`${shape.id} bulb matches the ${p.hardware.socketBase} socket.`);
  }
  if (p.bulb.watts > p.hardware.socket.ratedWatts) {
    status = 'fail';
    lines.push(`Bulb draws ${fmt(p.bulb.watts)} W but the socket is rated ${fmt(p.hardware.socket.ratedWatts, 0)} W.`);
  } else {
    lines.push(`Bulb ${fmt(p.bulb.watts)} W ≤ socket rating ${fmt(p.hardware.socket.ratedWatts, 0)} W.`);
  }
  if (p.bulb.markedWatts < p.bulb.watts) {
    status = 'fail';
    lines.push(
      `Marked wattage ${fmt(p.bulb.markedWatts)} W is below the bulb in use (${fmt(p.bulb.watts)} W); the marking must cover the hottest bulb that may be installed.`,
    );
  } else {
    lines.push(`Marked ${fmt(p.bulb.markedWatts)} W covers the ${fmt(p.bulb.watts)} W bulb.`);
  }
  return {
    id: 'socket-bulb',
    title: 'Socket and bulb',
    status,
    detail: lines.join(' '),
    source: 'ANSI C78 bulb shapes, ANSI C81.61 socket threads; socket rating from its own marking',
  };
}

/* -------------------------------------------------------------------------------------------------
 * 2. Shade designation — §47.3, Table 47.1
 * ----------------------------------------------------------------------------------------------- */

interface Designation {
  top: 'open' | 'closed';
  bottom: 'open' | 'closed';
  rowFound: boolean;
  requiredCm2: number;
  requiredBottomCm2: number;
  obstructed: boolean;
  rimCm2: number;
  obstructionCm2: number;
  unobstructedCm2: number;
  topCm2: number;
}

function designate(p: LampParams, layout: Layout): Designation {
  const row = UL153_OPENING_AREA.find((r) => r.watts >= p.bulb.markedWatts);
  const obstructed = p.shade.mount === 'spider' || p.shade.mount === 'fitter';
  // Base- and lip-mounted shades stand on the base: the base closes the opening below the lamp.
  const seated = p.shade.mount === 'base' || p.shade.mount === 'lip';
  const rimCm2 = seated ? 0 : rimAreaCm2(layout.shade, 0);
  let obstructionCm2 = 0;
  if (obstructed) {
    // §47.3.4: hub and spokes projected on the opening are obstructions (lampholder / ≤12.7 mm nipple are not)
    const hub = (Math.PI / 4) * (p.shade.hubOuterDiameter ** 2 - layout.hubHoleDiameter ** 2);
    const tMount = Math.min(1, Math.max(0, p.shade.mountHeight / Math.max(1e-6, layout.shade.height)));
    const span = Math.max(0, meanInner(layout.shade, tMount) - p.shade.hubOuterDiameter / 2);
    obstructionCm2 = (hub + p.shade.spokeCount * p.shade.spokeWidth * span) / 100;
  }
  const topCm2 =
    p.shade.topClosure === 'open'
      ? rimAreaCm2(layout.shade, 1)
      : p.shade.topClosure === 'vented'
        ? (p.shade.ventCount * Math.PI * (p.shade.ventDiameter / 2) ** 2) / 100
        : 0;
  const required = row ? row.areaCm2 : Infinity;
  return {
    top: topCm2 >= required ? 'open' : 'closed',
    bottom: rimCm2 - obstructionCm2 >= (obstructed ? 1.1 * required : required) ? 'open' : 'closed',
    rowFound: !!row,
    requiredCm2: required,
    requiredBottomCm2: obstructed ? 1.1 * required : required,
    obstructed,
    rimCm2,
    obstructionCm2,
    unobstructedCm2: rimCm2 - obstructionCm2,
    topCm2,
  };
}

function designationCheck(p: LampParams, d: Designation): SafetyCheck {
  const detail: string[] = [];
  let status: Status = 'pass';
  if (!d.rowFound) {
    return {
      id: 'shade-designation',
      title: 'Shade designation (Table 47.1)',
      status: 'fail',
      detail: `Marked wattage ${fmt(p.bulb.markedWatts, 0)} W is above the highest Table 47.1 row (300 W), so no opening-area requirement exists for it.`,
      source: `${UL153_SOURCE}, §47.3 Table 47.1`,
    };
  }
  if (d.obstructed) {
    detail.push(
      `Bottom rim ${fmt(d.rimCm2)} cm² − obstructions ${fmt(d.obstructionCm2)} cm² (hub annulus + spokes) = ${fmt(d.unobstructedCm2)} cm² unobstructed vs ${fmt(d.requiredBottomCm2)} cm² required (1.1 × ${fmt(d.requiredCm2, 0)} cm² because the opening is obstructed, §47.3.4) → ${d.bottom}.`,
    );
  } else if (p.shade.mount === 'base' || p.shade.mount === 'lip') {
    detail.push('Bottom: the shade stands on the base, which closes the opening below the lamp → closed.');
  } else {
    detail.push(
      `Bottom opening ${fmt(d.rimCm2)} cm² vs ${fmt(d.requiredCm2, 0)} cm² required → ${d.bottom}.`,
    );
  }
  detail.push(`Top opening ${fmt(d.topCm2)} cm² vs ${fmt(d.requiredCm2, 0)} cm² required → ${d.top}.`);
  if (d.top === 'closed' && d.bottom === 'closed') {
    if (p.bulb.markedWatts > UL153_CLOSED_CLOSED.maxWatts) {
      status = 'fail';
      detail.push(
        `Designation closed/closed — §47.3.2 only allows this up to ${UL153_CLOSED_CLOSED.maxWatts} W, but the marking is ${fmt(p.bulb.markedWatts)} W.`,
      );
    } else {
      detail.push(
        `Designation closed/closed (≤ ${UL153_CLOSED_CLOSED.maxWatts} W per §47.3.2).`,
      );
    }
  } else {
    const table =
      d.bottom === 'open' && d.top === 'open'
        ? 'Table 47.2'
        : d.bottom === 'closed'
          ? 'Table 47.3'
          : 'Table 47.4';
    detail.push(`Designation ${d.top}/${d.bottom} — spacing per ${table}.`);
    const bottomRatio = d.unobstructedCm2 / d.requiredBottomCm2;
    const topRatio = d.topCm2 / d.requiredCm2;
    if (d.bottom === 'open' && bottomRatio < 1.1) {
      status = 'warn';
      detail.push(
        `Bottom area is within 10 % of its threshold (${fmt(bottomRatio * 100, 0)} % of required) — print variance could flip the designation and move you to a stricter spacing table.`,
      );
    }
    if (d.top === 'open' && topRatio < 1.1) {
      status = 'warn';
      detail.push(
        `Top area is within 10 % of its threshold (${fmt(topRatio * 100, 0)} % of required).`,
      );
    }
    const seated = p.shade.mount === 'base' || p.shade.mount === 'lip';
    const droppedBottom = d.bottom === 'closed' && !seated;
    if (droppedBottom || d.top === 'closed') {
      status = 'warn';
      detail.push(
        `One opening is below its area threshold, so the designation dropped to ${d.top}/${d.bottom} and the stricter ${droppedBottom ? 'Table 47.3' : 'Table 47.4'} spacing applies.`,
      );
    }
  }
  return {
    id: 'shade-designation',
    title: 'Shade designation (Table 47.1)',
    status,
    detail: detail.join(' '),
    source: `${UL153_SOURCE}, §47.3 Table 47.1 & §47.3.4`,
  };
}

/* -------------------------------------------------------------------------------------------------
 * 3. Lamp-to-shade spacing — §47.4
 * ----------------------------------------------------------------------------------------------- */

interface CenterlineResult {
  dist: number;
  z: number;
  surface: 'wall' | 'top cap' | 'hub plane';
  /** distance ignoring the hub plane (wall + cap only) */
  shadeDist: number;
}

/**
 * Minimum distance (mm) from any point of the lamp centerline (vertical segment from the centre
 * contact) to the shade: the nominal inner wall, the top cap when the top is designated closed,
 * and — for spider/fitter mounts — the hub/spoke plane, all treated as shade surface.
 */
function centerlineClearance(
  p: LampParams,
  layout: Layout,
  centerline: number,
  includeHub: boolean,
  topClosed: boolean,
): CenterlineResult {
  const shade = layout.shade;
  const steps = 240;
  let best: CenterlineResult = { dist: Infinity, z: 0, surface: 'wall', shadeDist: Infinity };
  let shadeDist = Infinity;
  const capZ = layout.shadeTop - p.shade.topThickness;
  for (let i = 0; i <= steps; i++) {
    const z = layout.contactZ + (i / steps) * centerline;
    let wall: number;
    if (z < layout.shadeBottom) wall = Math.hypot(minInner(shade, 0), layout.shadeBottom - z);
    else if (z > layout.shadeTop) wall = Math.hypot(minInner(shade, 1), z - layout.shadeTop);
    else wall = minInner(shade, (z - layout.shadeBottom) / Math.max(1e-6, shade.height));
    if (wall < best.dist) best = { ...best, dist: wall, z, surface: 'wall' };
    shadeDist = Math.min(shadeDist, wall);
    if (topClosed) {
      // the cap spans the full top opening; the axis point is always inside its footprint
      const capDist = Math.max(0, z - layout.shadeTop, capZ - z);
      if (capDist < best.dist) best = { ...best, dist: capDist, z, surface: 'top cap' };
      shadeDist = Math.min(shadeDist, capDist);
    }
    if (includeHub && layout.hubThickness > 0) {
      const dz = Math.max(0, layout.hubBottom - z, z - (layout.hubBottom + layout.hubThickness));
      const hubDist = Math.hypot(layout.hubHoleDiameter / 2, dz);
      if (hubDist < best.dist) best = { ...best, dist: hubDist, z, surface: 'hub plane' };
    }
  }
  return { ...best, shadeDist };
}

function exceedsRangeDetail(p: LampParams, table: string, maxWatts: number): string {
  return (
    `Marked wattage ${fmt(p.bulb.markedWatts, 0)} W exceeds the highest ${table} row for a ${p.hardware.socketBase} ` +
    `lampholder (${maxWatts} W), so the fixed spacings cannot be met by geometry. Lower the marking, or the ` +
    `luminaire must pass the full UL 153 temperature test instead of the §47 exemption.`
  );
}

/**
 * Spacing verdict. When only the hub/spoke plane (clamped around the lampholder) is too close, the shade
 * itself is adequately spaced but the construction is not §47 temperature-test-exempt — that is a warn
 * (the thermal estimate and a real temperature test govern), not a geometric fail.
 */
function spacingVerdict(measured: CenterlineResult, required: number): { status: Status; note: string } {
  if (measured.dist >= required) return { status: 'pass', note: '' };
  if (measured.surface === 'hub plane' && measured.shadeDist >= required)
    return {
      status: 'warn',
      note:
        ` The shade wall clears it (${fmt(measured.shadeDist)} mm); only the hub/spoke plane around the socket is closer, which no shade size can change. ` +
        'This construction is therefore not §47 temperature-test-exempt: rely on the thermal estimate below and verify with a temperature test — or use a base-groove mount / nipple socket that lifts the contact above the hub.',
    };
  return { status: 'fail', note: '' };
}

function spacingCheck(p: LampParams, layout: Layout, d: Designation): SafetyCheck {
  const base = p.hardware.socketBase;
  const W = p.bulb.markedWatts;
  const includeHub = p.shade.mount === 'spider' || p.shade.mount === 'fitter';
  const topClosed = d.top === 'closed';
  const source = `${UL153_SOURCE}, §47.4`;
  const passNote =
    'Compliant: temperature-test-exempt construction (any shade material permitted per §16.2).';

  if (d.top === 'closed' && d.bottom === 'closed') {
    const measured = centerlineClearance(
      p,
      layout,
      UL153_CLOSED_CLOSED.centerline,
      includeHub,
      topClosed,
    );
    const wattsOk = W <= UL153_CLOSED_CLOSED.maxWatts;
    const ok = wattsOk && measured.dist >= UL153_CLOSED_CLOSED.spacing;
    return {
      id: 'shade-spacing',
      title: 'Lamp-to-shade spacing',
      status: ok ? 'pass' : 'fail',
      detail:
        `Closed/closed (§47.3.2/§47.4.3): ${fmt(UL153_CLOSED_CLOSED.spacing)} mm minimum from a ` +
        `${fmt(UL153_CLOSED_CLOSED.centerline)} mm centerline — measured ${fmt(measured.dist)} mm to the ` +
        `${measured.surface}. ` +
        (ok
          ? passNote
          : wattsOk
            ? 'Increase the shade diameter/height or reduce the marking.'
            : `A closed/closed shade is only permitted up to ${UL153_CLOSED_CLOSED.maxWatts} W (marked ${fmt(W, 0)} W) — open the top or bottom.`),
      source,
    };
  }

  if (d.bottom === 'open' && d.top === 'open') {
    const rows = UL153_OPEN_OPEN[base];
    const row = rows.find((r) => r.watts >= W);
    if (!row)
      return { id: 'shade-spacing', title: 'Lamp-to-shade spacing', status: 'fail', detail: exceedsRangeDetail(p, 'Table 47.2', rows[rows.length - 1].watts), source };
    const measured = centerlineClearance(p, layout, row.centerline, includeHub, topClosed);
    const v = spacingVerdict(measured, row.spacing);
    return {
      id: 'shade-spacing',
      title: 'Lamp-to-shade spacing (open/open)',
      status: v.status,
      detail:
        `Table 47.2 (${base}, ${fmt(row.watts, 0)} W row): ≥ ${fmt(row.spacing)} mm from any point of a ` +
        `${fmt(row.centerline)} mm centerline — measured ${fmt(measured.dist)} mm to the ${measured.surface} ` +
        `(closest at z = ${fmt(measured.z)} mm${includeHub ? '; hub/spoke plane counted as shade surface' : ''}). ` +
        `${v.status === 'pass' ? passNote : `Short by ${fmt(row.spacing - measured.dist)} mm.`}${v.note || (v.status === 'fail' ? ' Enlarge the shade or lower the marking.' : '')}`,
      source,
    };
  }

  if (d.bottom === 'closed') {
    const rows = UL153_OPEN_CLOSED[base];
    const row = rows.find((r) => r.watts >= W);
    if (!row)
      return { id: 'shade-spacing', title: 'Lamp-to-shade spacing', status: 'fail', detail: exceedsRangeDetail(p, 'Table 47.3', rows[rows.length - 1].watts), source };
    const measured = centerlineClearance(p, layout, row.centerline, includeHub, topClosed);
    const v = spacingVerdict(measured, row.spacing);
    return {
      id: 'shade-spacing',
      title: 'Lamp-to-shade spacing (open top / closed bottom)',
      status: v.status,
      detail:
        `Table 47.3 (${base}, ${fmt(row.watts, 0)} W row): ≥ ${fmt(row.spacing)} mm from any point of a ` +
        `${fmt(row.centerline)} mm centerline — measured ${fmt(measured.dist)} mm to the ${measured.surface}. ` +
        `${v.status === 'pass' ? passNote : `Short by ${fmt(row.spacing - measured.dist)} mm.`}${v.note || (v.status === 'fail' ? ' Enlarge the shade, open up the bottom rim, or lower the marking.' : '')}`,
      source,
    };
  }

  // closed top / open bottom — Table 47.4 trades spacing against shade height above the centerline
  const rows = UL153_CLOSED_OPEN[base];
  const row = rows.find((r) => r.watts >= W);
  if (!row)
    return { id: 'shade-spacing', title: 'Lamp-to-shade spacing', status: 'fail', detail: exceedsRangeDetail(p, 'Table 47.4', rows[rows.length - 1].watts), source };
  const measured = centerlineClearance(p, layout, row.centerline, includeHub, topClosed);
  const heightAbove = layout.shadeTop - (layout.contactZ + row.centerline);
  const options = row.options.map((o) => ({
    verdict: heightAbove >= o.height ? spacingVerdict(measured, o.spacing) : { status: 'fail' as Status, note: '' },
    spacing: o.spacing,
    height: o.height,
  }));
  const bestOpt = options.find((o) => o.verdict.status === 'pass') ?? options.find((o) => o.verdict.status === 'warn');
  const mark = (s: Status) => (s === 'pass' ? '✓' : s === 'warn' ? '~' : '✗');
  const lines = [
    `Table 47.4 (${base}, ${fmt(row.watts, 0)} W row): shade top is ${fmt(heightAbove)} mm above the top of the ` +
      `${fmt(row.centerline)} mm centerline, spacing ${fmt(measured.dist)} mm to the ${measured.surface}. ` +
      `Options: ${options.map((o) => `${mark(o.verdict.status)} h ≥ ${fmt(o.height)} mm & spacing ≥ ${fmt(o.spacing)} mm`).join(', ')}.`,
  ];
  if (bestOpt?.verdict.status === 'pass') {
    lines.push(`Satisfied by the ${fmt(bestOpt.height)} mm-height / ${fmt(bestOpt.spacing)} mm-spacing option. ${passNote}`);
  } else if (bestOpt) {
    lines.push(bestOpt.verdict.note.trim());
  } else {
    lines.push('No option satisfied — raise the shade top or enlarge the shade (or lower the marking).');
  }
  return {
    id: 'shade-spacing',
    title: 'Lamp-to-shade spacing (closed top / open bottom)',
    status: bestOpt ? bestOpt.verdict.status : 'fail',
    detail: lines.join(' '),
    source,
  };
}

function clearanceInfo(layout: Layout): SafetyCheck {
  const c = shadeBulbClearance(layout.shade, layout.shadeBottom, layout.bulbProfile);
  return {
    id: 'bulb-clearance',
    title: 'Measured bulb clearance',
    status: 'info',
    detail:
      `Closest approach of the nominal inner wall to the bulb envelope is ${fmt(c.distance)} mm, at ` +
      `${Math.round(c.t * 100)} % of the shade height (angle ${Math.round((c.phi * 180) / Math.PI)}°). ` +
      `Surface styles only ever displace outward, so the real wall is at least this far from the bulb.`,
    source: 'shadeSurface invariant + shadeBulbClearance scan',
  };
}

/* -------------------------------------------------------------------------------------------------
 * 4. Material screening estimate (engineering model — not test data)
 * ----------------------------------------------------------------------------------------------- */

function thermalShadeCheck(p: LampParams, layout: Layout, d: Designation): SafetyCheck {
  const tech = BULB_TECH[p.bulb.tech];
  const amb = p.materials.ambient;
  const mat = MATERIALS[p.materials.shade];
  const limit = mat.hdt - p.materials.heatMargin;
  const c = bulbCentroid(layout);
  const Qc = p.bulb.watts * tech.heatFraction * (1 - tech.radiantFraction);
  const Tk = amb + 273.15;
  const rho = 101325 / (287.05 * Tk); // air density at ambient, ideal gas
  const cp = 1006; // J/kg·K, air
  const g = 9.81;
  // Heskestad-style plume coefficient for a small heat source
  const plumeCoef = 9.1 * Math.cbrt(Tk / (g * cp * cp * rho * rho));
  const plumeRise = (zc: number) => plumeCoef * Math.pow(Qc, 2 / 3) * Math.pow(zc, -5 / 3);
  const closedTop = d.top === 'closed';
  const trapFactor = closedTop ? 1.5 : 1;

  const riseAt = (x: number, y: number, z: number): number => {
    const dm = Math.max(Math.hypot(x - c.x, y - c.y, z - c.z) / 1000, 0.01);
    const dTrad = ((p.bulb.watts * tech.radiantFraction) / (4 * Math.PI * dm * dm)) * 0.5 / 10;
    const zrel = (z - c.z) / 1000;
    const zc = Math.max(zrel, 0.05);
    const plume = zrel > 0 && Math.hypot(x - c.x, y - c.y) / 1000 <= 0.25 * zc ? plumeRise(zc) : 0;
    return (dTrad + plume) * trapFactor;
  };

  let maxRise = 0;
  let where = '';
  const shade = layout.shade;
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const z = layout.shadeBottom + t * shade.height;
    for (let j = 0; j < PHI_STEPS; j++) {
      const phi = (j / PHI_STEPS) * Math.PI * 2;
      const r = shade.innerRadius(t, phi);
      const rise = riseAt(c.x + r * Math.cos(phi), c.y + r * Math.sin(phi), z);
      if (rise > maxRise) {
        maxRise = rise;
        where = `${Math.round(t * 100)} % up the inner wall`;
      }
    }
  }
  if (closedTop) {
    // underside of the top cap: centre is in the plume, the rim only sees radiation
    const capZ = layout.shadeTop - p.shade.topThickness;
    const capR = minInner(shade, 1);
    for (let k = 0; k <= 6; k++) {
      const rise = riseAt(c.x + (capR * k) / 6, c.y, capZ);
      if (rise > maxRise) {
        maxRise = rise;
        where = 'top cap underside';
      }
    }
  }
  const T = amb + maxRise;
  const status: Status = T <= limit ? 'pass' : T <= limit + 10 ? 'warn' : 'fail';
  return {
    id: 'thermal-shade',
    title: 'Shade material heat screening (estimate)',
    status,
    detail:
      `${tech.label} at ${fmt(p.bulb.watts)} W (${Math.round(tech.radiantFraction * 100)} % radiant, ` +
      `${fmt(Qc)} W convective): hottest modelled point (${where}) reaches ≈ ${fmt(T)} °C = ${fmt(amb, 0)} °C ` +
      `ambient + ${fmt(maxRise)} °C rise, vs ${mat.label} service limit ${fmt(limit, 0)} °C (HDT ${mat.hdt} °C ` +
      `− ${fmt(p.materials.heatMargin, 0)} °C margin)${closedTop ? ', including the ×1.5 factor for heat trapped by the closed top' : ''}. ` +
      `Screening estimate only (point-source radiation absorbed 50 % at h = 10 W/m²·K, plus a Heskestad plume above the bulb) — ` +
      `confirm with a 2-hour thermocouple test at full wattage before regular use.`,
    source: `${mat.source}; model per Luz docs/SPEC.md (engineering estimate)`,
  };
}

function thermalSocketCheck(p: LampParams): SafetyCheck {
  const tech = BULB_TECH[p.bulb.tech];
  const amb = p.materials.ambient;
  const led = p.bulb.tech === 'led' || p.bulb.tech === 'ledFilament';
  const rise = led ? 25 : Math.min(p.bulb.watts * 0.6, 120);
  const T = amb + rise;
  const struct = MATERIALS[p.materials.structure];
  const structLimit = struct.hdt - p.materials.heatMargin;
  let status: Status = T <= structLimit ? 'pass' : T <= structLimit + 10 ? 'warn' : 'fail';
  const parts = [
    `cup (${struct.label}, limit ${fmt(structLimit, 0)} °C)`,
  ];
  if (p.shade.mount === 'spider' || p.shade.mount === 'fitter') {
    const shadeMat = MATERIALS[p.materials.shade];
    const shadeLimit = shadeMat.hdt - p.materials.heatMargin;
    parts.push(`hub (${shadeMat.label}, limit ${fmt(shadeLimit, 0)} °C)`);
    const s2: Status = T <= shadeLimit ? 'pass' : T <= shadeLimit + 10 ? 'warn' : 'fail';
    if (s2 === 'fail' || (s2 === 'warn' && status !== 'fail')) status = s2;
  }
  return {
    id: 'thermal-socket',
    title: 'Parts near the socket (estimate)',
    status,
    detail:
      `${tech.label} ${fmt(p.bulb.watts)} W puts the socket body around ${fmt(T)} °C (${fmt(amb, 0)} °C ambient + ` +
      `${led ? '25 (LED driver heat)' : `${fmt(rise, 0)} (0.6 °C/W, capped at 120)`}) against the ${parts.join(' and the ')}. ` +
      `Screening estimate, not test data — verify the cup inner face with a thermocouple after 2 hours at full wattage.`,
    source: 'Engineering estimate (BULB_TECH envelope data); material HDT per MATERIALS',
  };
}

/* -------------------------------------------------------------------------------------------------
 * 5. Stability — §132
 * ----------------------------------------------------------------------------------------------- */

function convexHull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  const upper: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper); // CCW
}

function stabilityCheck(p: LampParams, build: LampBuild): SafetyCheck {
  const layout = build.layout;
  const e26 = p.hardware.socketBase === 'E26';
  const bulbC = bulbCentroid(layout);
  const masses: Array<{ m: number; c: Vec3 }> = build.parts.map((part: PartMesh) => ({
    m: part.mass,
    c: part.centroid,
  }));
  masses.push({
    m: e26 ? 40 : 15,
    c: [layout.axisX, layout.axisY, (layout.socketBottom + layout.socketTop) / 2],
  });
  masses.push({ m: e26 ? 50 : 25, c: [bulbC.x, bulbC.y, bulbC.z] });
  masses.push({ m: 20, c: [layout.axisX, layout.axisY, (layout.baseBottom + layout.baseTop) / 2] }); // cord in the base
  const dowels = p.base.legKind === 'dowel' ? layout.legs : [];
  let dowelGrams = 0;
  for (const { top, tip } of dowels) {
    const len = Math.hypot(top[0] - tip[0], top[1] - tip[1], top[2] - tip[2]);
    const grams = ((Math.PI * (p.base.dowelDiameter / 2) ** 2 * len) / 1000) * DOWEL_MATERIALS[p.base.dowelMaterial].density;
    dowelGrams += grams;
    masses.push({ m: grams, c: [(top[0] + tip[0]) / 2, (top[1] + tip[1]) / 2, (top[2] + tip[2]) / 2] });
  }
  let m = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const part of masses) {
    m += part.m;
    cx += part.m * part.c[0];
    cy += part.m * part.c[1];
    cz += part.m * part.c[2];
  }
  cx /= m;
  cy /= m;
  cz /= m;

  // Support polygon: the leg tips for a legged stand, else the convex hull of the base's bottom ring
  // inset by the bottom edge radius.
  const legged = layout.legs.length > 0;
  const phis = angles(AREA_STEPS);
  const ring: Vec2[] = legged
    ? layout.legs.map(({ tip }) => [tip[0], tip[1]] as Vec2)
    : sectionRing(p.base.section, p.base.size, phis, 0, p.base.bottomEdgeRadius);
  const hull = convexHull(ring);

  let tipDeg = Infinity;
  let worstDir = 0;
  let inside = true;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const nx = ey / len; // outward normal of a CCW edge
    const ny = -ex / len;
    // distance from the COM to the edge along the outward normal: positive while the COM is inside
    const s = (a[0] - cx) * nx + (a[1] - cy) * ny;
    if (s < 1e-6) inside = false;
    const tip = (Math.atan2(Math.max(0, s), cz) * 180) / Math.PI;
    if (tip < tipDeg) {
      tipDeg = tip;
      worstDir = (Math.atan2(ny, nx) * 180) / Math.PI;
    }
  }

  const status: Status = !inside || tipDeg <= UL153_STABILITY_DEG ? 'fail' : tipDeg < 12 ? 'warn' : 'pass';
  return {
    id: 'stability',
    title: 'Tip-over stability (§132)',
    status,
    detail:
      `Assembled centre of mass: ${fmt(m, 0)} g at ${fmt(cz)} mm above the table (includes ${e26 ? '40' : '15'} g socket, ` +
      `${e26 ? '50' : '25'} g bulb and 20 g cord${dowels.length ? `, ${fmt(dowelGrams, 0)} g of ${p.base.dowelMaterial} dowels` : ''}). Tipping over the ${legged ? `${layout.legs.length} leg tips (${fmt(p.base.legSpread, 0)} mm spread)` : `${fmt(p.base.size, 0)} mm base footprint`} ` +
      `${legged ? '' : `(inset ${fmt(p.base.bottomEdgeRadius)} mm for the bottom edge) `}starts at ${fmt(tipDeg)} ° of incline, worst ` +
      `toward ${fmt(worstDir, 0)}°. UL 153 §132 requires stability on an ${UL153_STABILITY_DEG} ° incline` +
      `${status === 'fail' ? ' — not met: widen or weigh the base (weight pocket), or shorten the lamp.' : status === 'warn' ? ' — met, but under 12° of margin is fragile on thick carpet.' : ' with margin.'}`,
    source: `${UL153_SOURCE}, §132`,
  };
}

/* -------------------------------------------------------------------------------------------------
 * 6. Printability
 * ----------------------------------------------------------------------------------------------- */

const BED = { x: 256, y: 256, z: 256 };

function printChecks(p: LampParams, build: LampBuild): SafetyCheck[] {
  const checks: SafetyCheck[] = [];
  const s = p.shade;
  const wall = s.vaseMode ? s.vaseLineWidth : s.wallThickness;
  checks.push({
    id: 'print-wall',
    title: 'Shade wall thickness',
    status: wall >= 0.8 ? 'pass' : 'warn',
    detail:
      `${s.vaseMode ? `Vase mode: a single ${fmt(wall, 2)} mm line` : `Minimum wall ${fmt(wall, 2)} mm`} ` +
      `(rim bands thicken to ${fmt(s.wallThickness + s.rimThickening, 2)} mm) — ` +
      `${wall >= 0.8 ? 'at least the 0.8 mm minimum for a serviceable wall.' : `below the 0.8 mm minimum; expect gaps and fragility (a 0.4 mm nozzle wants ≥ 2 perimeters ≈ 0.8 mm).`}`,
    source: 'FDM practice',
  });

  // overhang: outward flare of the nominal outer profile between rings, in the direction the shade prints
  // (a flipped shade prints top-down, so an inward-closing top becomes an outward flare from the bed)
  const flipped = build.parts.find((part) => part.id === 'shade')?.printFlip ?? false;
  const steps = 96;
  const dz = s.height / steps;
  let maxAngle = 0;
  let atT = 0;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    let dr = 0;
    for (let j = 0; j < 36; j++) {
      const phi = (j / 36) * Math.PI * 2;
      const step = build.layout.shade.outerRadius(t1, phi) - build.layout.shade.outerRadius(t0, phi);
      dr = Math.max(dr, flipped ? -step : step);
    }
    const angle = (Math.atan2(dr, dz) * 180) / Math.PI;
    if (angle > maxAngle) {
      maxAngle = angle;
      atT = t0;
    }
  }
  checks.push({
    id: 'print-overhang',
    title: 'Shade overhangs',
    status: maxAngle > 60 ? 'warn' : 'pass',
    detail:
      `Steepest outward flare of the nominal profile is ${fmt(maxAngle)} ° from vertical at ` +
      `${Math.round(atT * 100)} % of the shade height (surface styles add their own local overhangs on top). ` +
      `${maxAngle > 60 ? 'Beyond 60° from vertical FDM bridges poorly — reduce the bulge/taper or plan on supports.' : 'Within the 60°-from-vertical rule of thumb for unsupported FDM printing.'}`,
    source: 'FDM practice',
  });

  if (s.mount === 'spider' || s.mount === 'fitter') {
    const tMount = Math.min(1, Math.max(0, s.mountHeight / Math.max(1e-6, build.layout.shade.height)));
    const span = Math.max(0, meanInner(build.layout.shade, tMount) - s.hubOuterDiameter / 2);
    const flat = s.spokeRise === 0;
    checks.push({
      id: 'print-spokes',
      title: 'Spider / fitter spokes',
      status: 'info',
      detail: flat
        ? `spokeRise is 0°, so the ${s.spokeCount} spokes (${fmt(s.spokeWidth)} mm wide) print as flat bridges ` +
          `spanning ${fmt(span)} mm from hub to wall${span > 30 ? ' — more than 30 mm of unsupported span will sag; set spokeRise > 0 (they then rise to the wall) or add supports' : ''}.`
        : `Spokes rise at ${fmt(s.spokeRise)} ° from the hub plane to the wall, so they print as ramps (span ${fmt(span)} mm).`,
      source: 'FDM practice',
    });
  }

  const big: string[] = [];
  let largest = '';
  let largestDim = 0;
  for (const part of build.parts) {
    const dx = part.bbox.max[0] - part.bbox.min[0];
    const dy = part.bbox.max[1] - part.bbox.min[1];
    const dzp = part.bbox.max[2] - part.bbox.min[2];
    const worst = Math.max(dx, dy, dzp);
    if (worst > largestDim) {
      largestDim = worst;
      largest = `${part.label} ${fmt(dx, 0)}×${fmt(dy, 0)}×${fmt(dzp, 0)} mm`;
    }
    if (dx > BED.x || dy > BED.y || dzp > BED.z)
      big.push(`${part.label} ${fmt(dx, 0)}×${fmt(dy, 0)}×${fmt(dzp, 0)} mm`);
  }
  checks.push({
    id: 'print-bed',
    title: 'Bed fit (256×256×256 mm)',
    status: big.length > 0 ? 'info' : 'pass',
    detail:
      big.length > 0
        ? `Exceeds a 256×256×256 mm bed: ${big.join(', ')}. Print elsewhere, split the part, or scale down.`
        : `All parts fit a 256×256×256 mm bed (largest: ${largest}).`,
    source: 'Common FDM bed size',
  });

  const legged = p.base.legs >= 3;
  const route = legged
    ? 'The cord drops from the base centre between the legs — nothing for it to pinch.'
    : p.base.cordChannel
      ? `${p.base.shellWall > 0 ? 'Hollow base with a rim notch' : 'Base underside has a cord channel'} exiting at ${fmt(p.base.cordExitAngle, 0)}°, so the lamp sits flat and the cord is not pinched.`
      : `No cord channel on the base underside — the cord will lift or rock the base and can chafe where it exits. Enable base.cordChannel.`;
  checks.push({
    id: 'print-cord',
    title: 'Cord route',
    status: legged || p.base.cordChannel ? 'pass' : 'warn',
    detail: route,
    source: 'Assembly practice',
  });
  const clamp = build.layout.clamp;
  checks.push({
    id: 'cord-strain',
    title: 'Cord strain relief',
    status: clamp ? 'pass' : 'info',
    detail: clamp
      ? `Screw-down clamp across the cord channel squeezes the cord by ${fmt(p.hardware.strainRelief.squeeze)} mm, so a pull on the cord is taken by the base, not the splices or socket terminals. ` +
        'Also tie an Underwriters knot inside the socket. Test: a firm pull on the cord must not move it at the clamp.'
      : 'No printed cord clamp. A pull on the cord must never reach the splices or the socket terminals: tie an Underwriters knot inside the socket ' +
        '(and use a cord set with its own strain relief), or enable the screw-down clamp under a solid base.',
    source: 'UL 153 / CSA C22.2 No. 12 require supply-cord strain relief; OSHA 29 CFR 1926.405(g)(2)(iv) (no tension on joints or terminal screws)',
  });
  return checks;
}
