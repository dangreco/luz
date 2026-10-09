import { BULB_SHAPES, bulbProfile, type BulbShape } from './hardware';
import type { HardwareParams, LampParams } from './params';
import { angles, sectionRadius } from './section';
import { shadeSurface, type ShadeSurface } from './shadeSurface';

/**
 * Resolved vertical stack and derived dimensions — the single source of truth shared by geometry,
 * safety checks and the preview. World frame: Z up, table at z = 0, lamp axis through (axisX, axisY).
 *
 *   legs     z ∈ [0, baseBottom]               base.legs ≥ 3 only: splayed legs lift the base
 *   base     z ∈ [baseBottom, baseTop]         centred on the origin
 *   stem     z ∈ [baseTop, stemTop]            centred on (axisX, axisY)
 *   cup      z ∈ [stemTop, cupTop]             top plate occupies [cupTop − plateThickness, cupTop]
 *   hub      z ∈ [cupTop, cupTop + hubThk]     spider/fitter only: shade hub clamped on the cup top
 *   socket   ring mode: body below the plate, threaded skirt up through plate (+hub), shade ring on top
 *            nipple mode: socket cap sits on the plate (or hub), body above
 *            snap mode: face flange on the plate (or hub), body below; clip wings grip plate (+hub) from beneath
 *   contact  bulb centre contact; bulb grows upward along +Z from here
 *   shade    z ∈ [shadeBottom, shadeBottom + shade.height]
 */
export interface LegAxis {
  /** upper end of the leg axis, inside the base just under its top skin */
  top: [number, number, number];
  /** lower end: centre of the printed foot sphere, or the dowel axis on the table (z = 0) */
  tip: [number, number, number];
}

/** Diametral slack added around the cord wherever it passes through material. */
export const CORD_CLEAR = 0.8;

/** Diameter a bore must have so the cord — or the moulded plug, when the cord set is prewired — passes. */
export function cordBoreDiameter(hw: HardwareParams): number {
  if (!hw.prewiredCord) return Math.max(hw.cordWidth, hw.cordThickness) + 2 * CORD_CLEAR;
  return Math.hypot(hw.plugWidth, hw.plugThickness) + 2 * CORD_CLEAR;
}

/**
 * One splice-connector pocket under the base, open at the base underside, centred at (x, y). `along` is the unit XY
 * direction of the cord exit; sizes include the clearance.
 */
export interface WagoSlot {
  x: number;
  y: number;
  along: [number, number];
  /** pocket size along the exit direction, across it, and its depth up from the base underside */
  lenAlong: number;
  lenAcross: number;
  depth: number;
  /** true: connector stands wire-entries down (its depth is vertical); false: lies flat, levers down */
  standing: boolean;
}

/** Material the base keeps above a pocket so it never breaks through the top. */
export const POCKET_ROOF = 1.5;
/** Printed wall kept between a pocket and the cord bore / channel. */
const POCKET_WALL = 1.6;

/** Two pockets either side of the cord bore, or [] when disabled or the connectors cannot fit the base height. */
function wagoSlots(p: LampParams, axisX: number, axisY: number): WagoSlot[] {
  const hw = p.hardware;
  const w = hw.wago;
  if (!w.enabled) return [];
  const c = 2 * Math.max(0, w.clearance);
  const room = p.base.height - POCKET_ROOF;
  const standing = w.depth + c <= room;
  if (!standing && w.height + c > room) return [];
  const lenAlong = (standing ? w.width : w.depth) + c;
  const lenAcross = (standing ? w.height : w.width) + c;
  const exit = (p.base.cordExitAngle * Math.PI) / 180;
  const along: [number, number] = [Math.cos(exit), Math.sin(exit)];
  const across: [number, number] = [-along[1], along[0]];
  // keep clear of the cord bore, the cord channel and the spigot hole above it
  const channelW = (hw.prewiredCord ? hw.plugWidth : hw.cordWidth) + 2 * CORD_CLEAR;
  const joint = p.stem.height > 0 ? p.stem.baseJoint : p.stem.cupJoint;
  const jointD =
    joint.kind === 'spigot'
      ? Math.max(cordBoreDiameter(hw), p.stem.height > 0 ? p.stem.boreDiameter : 0) + 2 * Math.max(1.2, joint.spigotWall) + joint.clearance
      : 0;
  const off = Math.max(cordBoreDiameter(hw), channelW, jointD) / 2 + POCKET_WALL + lenAcross / 2;
  return [-1, 1].map((side) => ({
    x: axisX + across[0] * off * side,
    y: axisY + across[1] * off * side,
    along,
    lenAlong,
    lenAcross,
    depth: (standing ? w.depth : w.height) + c,
    standing,
  }));
}

/**
 * Screw-down cord clamp across the cord channel under a solid plinth: a printed bar sits flush in a recess in the
 * base underside and presses the cord up against the channel roof; two self-tapping screws pull it in. Centred at
 * (x, y) on the channel, `along` = unit XY exit direction.
 */
export interface StrainClamp {
  x: number;
  y: number;
  along: [number, number];
  /** bar length across the channel, width along it, thickness (= recess depth) */
  barLen: number;
  barWidth: number;
  thickness: number;
  /** screw centres at ±screwOffset across the channel */
  screwOffset: number;
  /** pilot hole depth above the recess floor */
  pilotDepth: number;
}

/** Min screw engagement in the printed base (self-tapping into plastic: ≥ 2–2.5 × the screw diameter). */
const SCREW_ENGAGE = 2.5;

function strainClamp(p: LampParams, axisX: number, axisY: number, wagos: WagoSlot[], issues: string[]): StrainClamp | null {
  const hw = p.hardware;
  const sr = hw.strainRelief;
  if (!sr.enabled) return null;
  const b = p.base;
  if (b.legs >= 3 || b.shellWall > 0 || !b.cordChannel) {
    issues.push(
      'The cord clamp sits in the underside cord channel of a solid plinth — enable the cord channel on a solid, leg-free base, or disable it and rely on an Underwriters knot at the socket.',
    );
    return null;
  }
  const ct = hw.prewiredCord ? hw.plugThickness : hw.cordThickness;
  const channelW = (hw.prewiredCord ? hw.plugWidth : hw.cordWidth) + 2 * CORD_CLEAR;
  const channelH = ct + 2 * CORD_CLEAR;
  // bar top = channel roof − cord thickness + squeeze, bar bottom flush with the underside
  const thickness = channelH - hw.cordThickness + sr.squeeze;
  const d = Math.max(1.5, sr.screwDiameter);
  const screwOffset = channelW / 2 + d / 2 + 2;
  const barLen = 2 * screwOffset + d + 4;
  const barWidth = Math.max(10, 2 * d + 4);
  const pilotDepth = SCREW_ENGAGE * d + 1;
  if (thickness < 1.6)
    issues.push(`Cord clamp bar would be only ${thickness.toFixed(1)} mm thick — increase the squeeze.`);
  if (thickness + pilotDepth > b.height - 1.5)
    issues.push(
      `Base is too low for the cord clamp screws (needs ≥ ${(thickness + pilotDepth + 1.5).toFixed(1)} mm) — raise the base or use smaller screws.`,
    );
  const exit = (b.cordExitAngle * Math.PI) / 180;
  const along: [number, number] = [Math.cos(exit), Math.sin(exit)];
  const across: [number, number] = [-along[1], along[0]];
  // distance from the axis to the base edge along the exit, at the underside
  let edge = Infinity;
  for (let s = 0; s < 400; s += 0.5) {
    const x = axisX + along[0] * s;
    const y = axisY + along[1] * s;
    const r = Math.hypot(x, y);
    const phi = Math.atan2(y, x);
    if (r > sectionRadius(b.section, phi) * b.size - b.bottomEdgeRadius) {
      edge = s;
      break;
    }
  }
  const sClamp = edge - 6 - barWidth / 2;
  // keep clear of the connector pockets and cord bore (on the axis) and the weight pocket (on the origin)
  const wagoReach = wagos.length ? wagos[0].lenAlong / 2 + 2 : 0;
  const cordR = cordBoreDiameter(hw) / 2 + 2;
  const x = axisX + along[0] * sClamp;
  const y = axisY + along[1] * sClamp;
  let fits = sClamp - barWidth / 2 >= Math.max(wagoReach, cordR);
  let nearest = Infinity;
  for (const [i, j] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0]]) {
    const cx = x + (along[0] * i * barWidth) / 2 + (across[0] * j * barLen) / 2;
    const cy = y + (along[1] * i * barWidth) / 2 + (across[1] * j * barLen) / 2;
    nearest = Math.min(nearest, Math.hypot(cx, cy));
    if (Math.hypot(cx, cy) > sectionRadius(b.section, Math.atan2(cy, cx)) * b.size - b.bottomEdgeRadius - 1.5) fits = false;
  }
  if (!fits)
    issues.push('Base is too small for the cord clamp between the cord bore and the edge — widen the base or disable the clamp.');
  else if (b.weightPocketDiameter > 0 && nearest < b.weightPocketDiameter / 2 + 1.6)
    issues.push('Cord clamp overlaps the weight pocket — shrink the weight pocket or disable the clamp.');
  return { x, y, along, barLen, barWidth, thickness, screwOffset, pilotDepth };
}

export interface Layout {
  axisX: number;
  axisY: number;
  baseBottom: number;
  baseTop: number;
  stemTop: number;
  cupTop: number;
  /** z of the shade hub's bottom face (spider / fitter mounts), else NaN */
  hubBottom: number;
  hubThickness: number;
  /** socket body bottom and top rim */
  socketBottom: number;
  socketTop: number;
  /** shade ring bottom face (ring mode), else NaN */
  ringBottom: number;
  contactZ: number;
  bulb: BulbShape;
  /** bulb envelope [z_world, r] polyline from the contact to the tip */
  bulbProfile: Array<[number, number]>;
  bulbTop: number;
  shadeBottom: number;
  shadeTop: number;
  /** resolved shade sizes (after 'clearance' auto-sizing) */
  shadeBottomSize: number;
  shadeTopSize: number;
  shade: ShadeSurface;
  /** hub hole diameter needed for the hardware passing through it */
  hubHoleDiameter: number;
  /** total height of the assembled lamp */
  totalHeight: number;
  /** human-readable problems with the stack itself (not safety) */
  issues: string[];
  /** base.legs ≥ 3: one axis per leg (printed or dowel), else empty */
  legs: LegAxis[];
  /** splice-connector pockets under the base (hardware.wago.enabled), else empty */
  wagos: WagoSlot[];
  /** screw-down cord clamp under the base (hardware.strainRelief.enabled), else null */
  clamp: StrainClamp | null;
}

export function bulbFor(p: LampParams): BulbShape {
  return (
    BULB_SHAPES.find((b) => b.id === p.bulb.shape && b.base === p.hardware.socketBase) ??
    BULB_SHAPES.find((b) => b.base === p.hardware.socketBase)!
  );
}

/** Radial distance from a point (r, z) in the axial half-plane to the bulb envelope; negative = inside. */
export function distanceToBulb(profile: Array<[number, number]>, r: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < profile.length - 1; i++) {
    const [z0, r0] = profile[i];
    const [z1, r1] = profile[i + 1];
    const dz = z1 - z0;
    const dr = r1 - r0;
    const len2 = dz * dz + dr * dr;
    const u = len2 > 0 ? Math.min(1, Math.max(0, ((z - z0) * dz + (r - r0) * dr) / len2)) : 0;
    best = Math.min(best, Math.hypot(z - (z0 + u * dz), r - (r0 + u * dr)));
  }
  const zMin = profile[0][0];
  const zMax = profile[profile.length - 1][0];
  if (z >= zMin && z <= zMax) {
    // inside test: compare with the envelope radius at this z
    for (let i = 0; i < profile.length - 1; i++) {
      const [z0, r0] = profile[i];
      const [z1, r1] = profile[i + 1];
      if (z >= Math.min(z0, z1) && z <= Math.max(z0, z1) && z1 !== z0) {
        if (r < r0 + ((z - z0) / (z1 - z0)) * (r1 - r0)) return -best;
        break;
      }
    }
  }
  return best;
}

/** Sampling resolution used by clearance searches (independent of export quality). */
const CLEAR_T = 48;
const CLEAR_PHI = 72;

/** Minimum distance from the shade's nominal inner wall to the bulb envelope, and where it occurs. */
export function shadeBulbClearance(
  surface: ShadeSurface,
  shadeBottom: number,
  profile: Array<[number, number]>,
  axisOffset = 0,
): { distance: number; t: number; phi: number } {
  let best = { distance: Infinity, t: 0, phi: 0 };
  for (let i = 0; i <= CLEAR_T; i++) {
    const t = i / CLEAR_T;
    const z = shadeBottom + t * surface.height;
    for (let j = 0; j < CLEAR_PHI; j++) {
      const phi = (j / CLEAR_PHI) * Math.PI * 2;
      const d = distanceToBulb(profile, surface.innerRadius(t, phi) - axisOffset, z);
      if (d < best.distance) best = { distance: d, t, phi };
    }
  }
  return best;
}

export function computeLayout(p: LampParams): Layout {
  const issues: string[] = [];
  const hw = p.hardware;
  const sock = hw.socket;
  const sh = p.shade;
  const axisX = p.stem.height > 0 ? p.stem.offsetX : 0;
  const axisY = p.stem.height > 0 ? p.stem.offsetY : 0;
  const baseBottom = p.base.legs >= 3 ? Math.max(0, p.base.legHeight) : 0;
  const legs: LegAxis[] = [];
  if (p.base.legs >= 3) {
    const b = p.base;
    const count = Math.round(b.legs);
    const dowel = b.legKind === 'dowel';
    // radius of the leg (or dowel sleeve) where it meets the base, and of its foot on the table
    const rTop = dowel ? (b.dowelDiameter + b.dowelClearance) / 2 + b.dowelSleeveWall : b.legDiameter / 2;
    const rFoot = dowel ? b.dowelDiameter / 2 : b.legTipDiameter / 2;
    let inradius = Infinity;
    for (const phi of angles(p.quality.radialSegments)) inradius = Math.min(inradius, sectionRadius(b.section, phi) * b.size);
    const rootR = Math.min(Math.max(0, b.legRootRadius), Math.max(0, inradius - rTop));
    // axes start just under the base top skin so a printed leg's union with the base is solid
    const zTop = baseBottom + Math.max(1, b.height - Math.max(1.5, b.shellWall));
    const rTip = b.legSpread / 2 - rFoot;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.PI / count + (b.cordExitAngle * Math.PI) / 180;
      legs.push({
        top: [Math.cos(a) * rootR, Math.sin(a) * rootR, zTop],
        tip: [Math.cos(a) * rTip, Math.sin(a) * rTip, dowel ? 0 : rFoot],
      });
    }
  }
  const baseTop = baseBottom + p.base.height;
  const stemTop = baseTop + Math.max(0, p.stem.height);
  const cupTop = stemTop + p.cup.height;
  const hasHub = sh.mount === 'spider' || sh.mount === 'fitter';
  const hubThickness = hasHub ? sh.hubThickness : 0;
  const hubBottom = hasHub ? cupTop : NaN;

  let socketBottom: number;
  let socketTop: number;
  let ringBottom = NaN;
  if (hw.socketMount === 'ring') {
    // Shade ring sits on the hub (or plate); the skirt must reach through plate + hub + ring.
    ringBottom = cupTop + hubThickness;
    socketTop = ringBottom + sock.ringThickness + 2;
    socketBottom = socketTop - sock.bodyLength;
    const needed = socketTop - (cupTop - p.cup.plateThickness);
    if (sock.skirtLength < needed)
      issues.push(
        `Socket skirt (${sock.skirtLength} mm) is shorter than plate + hub + ring stack (${needed.toFixed(1)} mm).`,
      );
    if (socketBottom < stemTop + 2)
      issues.push('Socket body is longer than the cup cavity — increase cup height.');
  } else if (hw.socketMount === 'snap') {
    // Face flange rests on the hub (or plate); the clip wings grip the whole sandwich from underneath.
    socketTop = cupTop + hubThickness;
    socketBottom = socketTop - sock.bodyLength;
    const grip = p.cup.plateThickness + hubThickness;
    if (grip < sock.gripMin - 1e-6 || grip > sock.gripMax + 1e-6)
      issues.push(
        `Snap-in clips grip ${sock.gripMin}–${sock.gripMax} mm but the plate${hubThickness > 0 ? ' + hub' : ''} is ${grip.toFixed(1)} mm — set the cup plate thickness${hubThickness > 0 ? ' and hub thickness' : ''} into that range.`,
      );
    if (sock.flangeDiameter <= sock.snapHoleDiameter + p.cup.clearance)
      issues.push('Snap-in socket flange is not wider than its mounting hole — it would fall through.');
    if (socketBottom < stemTop + 2)
      issues.push('Snap-in socket body is longer than the cup cavity — increase cup height.');
  } else {
    socketBottom = cupTop + hubThickness;
    socketTop = socketBottom + sock.bodyLength;
  }
  const contactZ = socketTop - sock.contactDepth;

  const bulb = bulbFor(p);
  const profile = bulbProfile(bulb, p.bulb.diameterOverride, p.bulb.lengthOverride).map(
    ([z, r]) => [z + contactZ, r] as [number, number],
  );
  const bulbTop = profile[profile.length - 1][0];

  const shadeBottom =
    sh.mount === 'base'
      ? baseTop - sh.baseGrooveDepth
      : sh.mount === 'lip'
        ? baseTop
        : (hasHub ? hubBottom : cupTop) - sh.mountHeight;

  let bottomSize = sh.bottomSize;
  let topSize = sh.topSize;
  if (sh.sizing === 'clearance') {
    // Scale both sizes uniformly so the nearest inner-wall point is exactly bulbClearance from the bulb.
    const at = (k: number) =>
      shadeBulbClearance(shadeSurface(sh, sh.bottomSize * k, sh.topSize * k), shadeBottom, profile).distance;
    let lo = 0.05;
    let hi = 1;
    while (at(hi) < sh.bulbClearance && hi < 64) hi *= 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < sh.bulbClearance) lo = mid;
      else hi = mid;
    }
    bottomSize = sh.bottomSize * hi;
    topSize = sh.topSize * hi;
  }
  const surface = shadeSurface(sh, bottomSize, topSize);
  const shadeTop = shadeBottom + sh.height;

  const hubHoleDiameter =
    (hw.socketMount === 'ring' ? sock.skirtDiameter : hw.socketMount === 'snap' ? sock.snapHoleDiameter : hw.nippleDiameter) +
    p.cup.clearance;
  if (hasHub && sh.hubOuterDiameter <= hubHoleDiameter + 4)
    issues.push('Shade hub outer diameter is too small for the socket hole.');
  if (sh.mount === 'base' || sh.mount === 'lip') {
    // compare the real rim (after shoulder rounding / ripples) with the base top
    const topSize = p.base.size * p.base.topScale;
    let rimTooWide = false;
    for (let i = 0; i < 72 && !rimTooWide; i++) {
      const phi = (i / 72) * Math.PI * 2;
      const twistTop = (p.base.twist * Math.PI) / 180;
      const rBase = sectionRadius(p.base.section, phi - twistTop) * topSize;
      const rShade = sh.mount === 'lip' ? surface.innerRadius(0, phi) : surface.outerRadius(0, phi);
      if (rShade > rBase + 0.01) rimTooWide = true;
    }
    if (rimTooWide)
      issues.push(
        sh.mount === 'lip'
          ? 'Shade inner wall is wider than the base top — the lip would overhang the base edge.'
          : 'Base-mounted shade is wider than the base top; the groove would cut off the base edge.',
      );
  }
  if (sh.mount === 'lip' && p.cup.size / 2 > surface.innerRadius(0, 0) - sh.baseGrooveClearance - 2.4)
    issues.push('Socket cup is wider than the lip opening — reduce the cup size or widen the shade.');

  const wagos = wagoSlots(p, axisX, axisY);
  if (hw.wago.enabled) {
    if (wagos.length === 0)
      issues.push(
        `Base is too low for the ${hw.wago.model} pockets (needs ≥ ${(hw.wago.height + 2 * hw.wago.clearance + POCKET_ROOF).toFixed(1)} mm) — raise the base or disable the connector holders.`,
      );
    else if (p.base.shellWall > 0)
      issues.push('Connector pockets need a solid base — set the hollow shell wall to 0 or disable the connector holders.');
    else {
      let inradius = Infinity;
      for (const phi of angles(72)) inradius = Math.min(inradius, sectionRadius(p.base.section, phi) * p.base.size - p.base.bottomEdgeRadius);
      const reach = Math.max(...wagos.map((s) => Math.hypot(s.x, s.y) + Math.hypot(s.lenAlong, s.lenAcross) / 2));
      if (reach > inradius - 2)
        issues.push('Connector pockets reach past the base edge — widen the base or disable the connector holders.');
      const legged = p.base.legs >= 3;
      if (!legged && p.base.weightPocketDiameter > 0) {
        const near = Math.min(...wagos.map((s) => Math.hypot(s.x, s.y) - Math.hypot(s.lenAlong, s.lenAcross) / 2));
        if (near < p.base.weightPocketDiameter / 2 + 1.6)
          issues.push('Connector pockets overlap the weight pocket — shrink the weight pocket or disable the connector holders.');
      }
    }
  }
  const clamp = strainClamp(p, axisX, axisY, wagos, issues);
  return {
    axisX,
    axisY,
    baseBottom,
    baseTop,
    stemTop,
    cupTop,
    hubBottom,
    hubThickness,
    socketBottom,
    socketTop,
    ringBottom,
    contactZ,
    bulb,
    bulbProfile: profile,
    bulbTop,
    shadeBottom,
    shadeTop,
    shadeBottomSize: bottomSize,
    shadeTopSize: topSize,
    shade: surface,
    hubHoleDiameter,
    totalHeight: Math.max(shadeTop, bulbTop, socketTop),
    issues,
    legs,
    wagos,
    clamp,
  };
}
