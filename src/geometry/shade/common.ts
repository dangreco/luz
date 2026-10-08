import type { Vec2 } from '../../model/section';
import { fromArrays } from '../mesh';
import type { Vec3 } from '../mesh';
import type { Manifold, ManifoldToplevel } from '../wasm';

export const TAU = Math.PI * 2;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** mulberry32: small, fast, deterministic PRNG (voronoi perforation seeds). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clip a convex CCW polygon to the half-plane (p − o)·n ≥ 0 (Sutherland–Hodgman). */
export function clipHalfPlane(poly: Vec2[], ox: number, oy: number, nx: number, ny: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = (a[0] - ox) * nx + (a[1] - oy) * ny;
    const db = (b[0] - ox) * nx + (b[1] - oy) * ny;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const f = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  return out;
}

/** Signed area of a polygon (positive when wound CCW). */
export function polygonArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/**
 * Convex radial prism used as a through-hole cutter. `poly` is a CCW polygon in the
 * local frame (u = tangential, v = vertical, origin at the hole centre) extruded along
 * the radial direction at world angle `phi`, from `rIn` (clear inside the hollow) to
 * `rOut` (clear of the outer surface) — a prism that pierces the whole wall.
 */
export function radialPrism(
  m: ManifoldToplevel,
  axisX: number,
  axisY: number,
  phi: number,
  z0: number,
  rIn: number,
  rOut: number,
  poly: Vec2[],
): Manifold {
  const k = poly.length;
  const cs = Math.cos(phi);
  const sn = Math.sin(phi);
  const pos = new Float32Array((2 * k + 2) * 3);
  const put = (idx: number, r: number, u: number, v: number): void => {
    pos[idx * 3] = axisX + r * cs - u * sn;
    pos[idx * 3 + 1] = axisY + r * sn + u * cs;
    pos[idx * 3 + 2] = z0 + v;
  };
  let mx = 0;
  let my = 0;
  for (const q of poly) {
    mx += q[0];
    my += q[1];
  }
  mx /= k;
  my /= k;
  for (let i = 0; i < k; i++) {
    put(i, rIn, poly[i][0], poly[i][1]);
    put(k + i, rOut, poly[i][0], poly[i][1]);
  }
  const cIn = 2 * k;
  const cOut = 2 * k + 1;
  put(cIn, rIn, mx, my);
  put(cOut, rOut, mx, my);
  const tri: number[] = [];
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    tri.push(i, j, k + j, i, k + j, k + i); // side quads, outward normals
    tri.push(cOut, k + i, k + j); // outer cap fan (wraps closed)
    tri.push(cIn, j, i); // inner cap fan
  }
  return fromArrays(m, pos, Uint32Array.from(tri));
}

/** Orthonormal right-handed basis with ex ≈ dir and ey ≈ hint (both normalised). */
export function basisFrom(dir: Vec3, hint: Vec3): { ex: Vec3; ey: Vec3; ez: Vec3 } {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const ex: Vec3 = [dir[0] / l, dir[1] / l, dir[2] / l];
  const d = hint[0] * ex[0] + hint[1] * ex[1] + hint[2] * ex[2];
  let y: Vec3 = [hint[0] - d * ex[0], hint[1] - d * ex[1], hint[2] - d * ex[2]];
  let ly = Math.hypot(y[0], y[1], y[2]);
  if (ly < 1e-9) {
    const seed: Vec3 = Math.abs(ex[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const d2 = seed[0] * ex[0] + seed[1] * ex[1] + seed[2] * ex[2];
    y = [seed[0] - d2 * ex[0], seed[1] - d2 * ex[1], seed[2] - d2 * ex[2]];
    ly = Math.hypot(y[0], y[1], y[2]);
  }
  const ey: Vec3 = [y[0] / ly, y[1] / ly, y[2] / ly];
  const ez: Vec3 = [
    ex[1] * ey[2] - ex[2] * ey[1],
    ex[2] * ey[0] - ex[0] * ey[2],
    ex[0] * ey[1] - ex[1] * ey[0],
  ];
  return { ex, ey, ez };
}

/**
 * Box centred on `center` with right-handed orthonormal axes (ex, ey, ez) and full
 * extents (lx, ly, lz). The mesh is built directly, so no transform conventions are
 * involved. Used for spider/fitter spokes.
 */
export function orientedBox(
  m: ManifoldToplevel,
  center: Vec3,
  ex: Vec3,
  ey: Vec3,
  ez: Vec3,
  lx: number,
  ly: number,
  lz: number,
): Manifold {
  const v: Vec3[] = [];
  for (let sz = 0; sz < 2; sz++)
    for (let sy = 0; sy < 2; sy++)
      for (let sx = 0; sx < 2; sx++) {
        const ax = sx ? lx / 2 : -lx / 2;
        const ay = sy ? ly / 2 : -ly / 2;
        const az = sz ? lz / 2 : -lz / 2;
        v.push([
          center[0] + ax * ex[0] + ay * ey[0] + az * ez[0],
          center[1] + ax * ex[1] + ay * ey[1] + az * ez[1],
          center[2] + ax * ex[2] + ay * ey[2] + az * ez[2],
        ]);
      }
  // vertex index = bx + 2·by + 4·bz; faces listed CCW seen from outside
  const faces = [
    [1, 3, 7, 5],
    [2, 0, 4, 6],
    [3, 2, 6, 7],
    [0, 1, 5, 4],
    [4, 5, 7, 6],
    [1, 0, 2, 3],
  ];
  const tri: number[] = [];
  for (const f of faces) tri.push(f[0], f[1], f[2], f[0], f[2], f[3]);
  const pos = new Float32Array(24);
  v.forEach((q, i) => pos.set(q, i * 3));
  return fromArrays(m, pos, Uint32Array.from(tri));
}
