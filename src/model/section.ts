import type { SectionParams } from './params';

export type Vec2 = [number, number];
const TAU = Math.PI * 2;

/**
 * Polar radius of a unit section (sharp circumscribed diameter = 1, i.e. radius 0.5 before aspect)
 * along world angle `phi` (radians). All section kinds are star-shaped about the origin, which is what
 * lets every lofted part and the shade use one fixed angular sampling.
 */
export function sectionRadius(s: SectionParams, phi: number): number {
  const local = phi - (s.rotation * Math.PI) / 180;
  // Undo the aspect stretch: find the direction in unstretched space that maps onto `local`.
  const ux = Math.cos(local);
  const uy = Math.sin(local) / s.aspect;
  const phi0 = Math.atan2(uy, ux);
  const r0 = unitRadius(s, phi0);
  const x = r0 * Math.cos(phi0);
  const y = r0 * Math.sin(phi0) * s.aspect;
  return Math.hypot(x, y);
}

function unitRadius(s: SectionParams, phi: number): number {
  const R = 0.5;
  switch (s.kind) {
    case 'circle':
      return R;
    case 'superellipse': {
      const p = Math.max(0.5, s.exponent);
      const c = Math.abs(Math.cos(phi));
      const sn = Math.abs(Math.sin(phi));
      return R * Math.pow(Math.pow(c, p) + Math.pow(sn, p), -1 / p);
    }
    case 'polygon': {
      const n = Math.max(3, Math.round(s.sides));
      const half = Math.PI / n;
      const apothem = R * Math.cos(half);
      // Vertex at angle 0; edge normals at half + k·2half. psi = angle from the nearest edge normal.
      let psi = (((phi - half) % (2 * half)) + 2 * half) % (2 * half);
      if (psi > half) psi -= 2 * half;
      const rc = Math.min(1, Math.max(0, s.cornerRadius)) * apothem;
      const innerApothem = apothem - rc;
      const halfEdge = innerApothem * Math.tan(half);
      const rEdge = apothem / Math.cos(psi);
      if (Math.abs(rEdge * Math.sin(psi)) <= halfEdge + 1e-12) return rEdge;
      // Ray hits the corner arc centred on the inner polygon's vertex.
      const cx = innerApothem;
      const cy = Math.sign(psi) * halfEdge;
      const ud = Math.cos(psi) * cx + Math.sin(psi) * cy;
      return ud + Math.sqrt(Math.max(0, ud * ud - (cx * cx + cy * cy) + rc * rc));
    }
  }
}

/** Evenly spaced angles 0..2π (exclusive), shared by every ring of a loft so vertices line up. */
export function angles(n: number): Float64Array {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = (i / n) * TAU;
  return a;
}

/** Ring of points for a section scaled to `size`, rotated by `twistDeg`, optionally inset by `inset` mm. */
export function sectionRing(
  s: SectionParams,
  size: number,
  phis: Float64Array,
  twistDeg = 0,
  inset = 0,
): Vec2[] {
  const tw = (twistDeg * Math.PI) / 180;
  const radii = Array.from(phis, (phi) => sectionRadius(s, phi - tw) * size);
  const insetRadii = inset > 0 ? insetPolar(radii, phis, inset) : radii;
  return insetRadii.map((r, i) => [r * Math.cos(phis[i]), r * Math.sin(phis[i])]);
}

/**
 * Inward offset of a polar curve by `d` (approximately the true parallel curve). The inset radius at each
 * angle is the minimum over nearby sample points of the distance-adjusted radius — equivalent to
 * eroding the shape by a disc of radius d, evaluated along each ray. Exact for circles; for sharp
 * polygon corners it produces the rounded inset an exact offset would.
 */
function insetPolar(radii: number[], phis: Float64Array, d: number): number[] {
  const n = radii.length;
  const pts = radii.map((r, i) => [r * Math.cos(phis[i]), r * Math.sin(phis[i])] as Vec2);
  const out = new Array<number>(n);
  const window = Math.max(2, Math.ceil(n / 4));
  for (let i = 0; i < n; i++) {
    const ux = Math.cos(phis[i]);
    const uy = Math.sin(phis[i]);
    // Largest r along the ray such that the disc of radius d at r·u stays inside every edge's half-plane
    // ⇔ distance from r·u to the boundary ≥ d. Use edge segments near this angle.
    let best = radii[i];
    for (let k = -window; k <= window; k++) {
      const a = pts[(i + k + n) % n];
      const b = pts[(i + k + 1 + n) % n];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const len = Math.hypot(ex, ey);
      if (len < 1e-12) continue;
      // outward normal of a CCW polygon edge
      const nx = ey / len;
      const ny = -ex / len;
      const denom = ux * nx + uy * ny;
      if (denom <= 1e-9) continue;
      const r = (a[0] * nx + a[1] * ny - d) / denom;
      if (r < best) best = r;
    }
    out[i] = Math.max(0, best);
  }
  return out;
}
