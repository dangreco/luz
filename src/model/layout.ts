import { BULB_SHAPES, bulbProfile, type BulbShape } from './hardware';
import type { LampParams } from './params';
import { sectionRadius } from './section';
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
 *   contact  bulb centre contact; bulb grows upward along +Z from here
 *   shade    z ∈ [shadeBottom, shadeBottom + shade.height]
 */
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
    (hw.socketMount === 'ring' ? sock.skirtDiameter : hw.nippleDiameter) + p.cup.clearance;
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
  };
}
