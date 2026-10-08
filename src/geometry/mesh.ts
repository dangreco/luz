import type { Manifold, ManifoldToplevel } from './wasm';

export type Vec3 = [number, number, number];

/** Flat triangle soup ready for three.js / STL / 3MF. */
export interface MeshArrays {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Closed solid lofted through rings of equal vertex count. Rings must wind CCW seen from +Z,
 * be ordered bottom → top, and each be star-shaped about its own centroid (caps are fans from it).
 */
export function loftSolid(m: ManifoldToplevel, rings: Vec3[][]): Manifold {
  const nr = rings.length;
  const n = rings[0].length;
  const pos = new Float32Array((nr * n + 2) * 3);
  rings.forEach((ring, i) => ring.forEach((v, k) => pos.set(v, (i * n + k) * 3)));
  const c0 = nr * n;
  const c1 = c0 + 1;
  pos.set(centroid(rings[0]), c0 * 3);
  pos.set(centroid(rings[nr - 1]), c1 * 3);
  const tris: number[] = [];
  sideQuads(tris, n, nr, 0, false);
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    tris.push(c0, k1, k);
    tris.push(c1, (nr - 1) * n + k, (nr - 1) * n + k1);
  }
  return fromArrays(m, pos, Uint32Array.from(tris));
}

/**
 * Hollow tube between outer and inner ring stacks (same ring count and vertex count), closed by
 * annular caps at the first and last ring. Same winding rules as loftSolid.
 */
export function loftTube(m: ManifoldToplevel, outer: Vec3[][], inner: Vec3[][]): Manifold {
  const nr = outer.length;
  const n = outer[0].length;
  const off = nr * n;
  const pos = new Float32Array(2 * off * 3);
  outer.forEach((ring, i) => ring.forEach((v, k) => pos.set(v, (i * n + k) * 3)));
  inner.forEach((ring, i) => ring.forEach((v, k) => pos.set(v, (off + i * n + k) * 3)));
  const tris: number[] = [];
  sideQuads(tris, n, nr, 0, false);
  sideQuads(tris, n, nr, off, true);
  const top = (nr - 1) * n;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    // bottom annulus (normal −Z)
    tris.push(k, off + k, off + k1, k, off + k1, k1);
    // top annulus (normal +Z)
    tris.push(top + k, off + top + k1, off + top + k, top + k, top + k1, off + top + k1);
  }
  return fromArrays(m, pos, Uint32Array.from(tris));
}

function sideQuads(tris: number[], n: number, nr: number, off: number, flip: boolean): void {
  for (let i = 0; i < nr - 1; i++) {
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const a = off + i * n + k;
      const b = off + i * n + k1;
      const c = off + (i + 1) * n + k1;
      const d = off + (i + 1) * n + k;
      if (flip) tris.push(a, c, b, a, d, c);
      else tris.push(a, b, c, a, c, d);
    }
  }
}

function centroid(ring: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const v of ring) {
    c[0] += v[0];
    c[1] += v[1];
    c[2] += v[2];
  }
  return [c[0] / ring.length, c[1] / ring.length, c[2] / ring.length];
}

/** Build a Manifold from an indexed, already-watertight triangle mesh (throws if not manifold). */
export function fromArrays(m: ManifoldToplevel, positions: Float32Array, indices: Uint32Array): Manifold {
  const mesh = new m.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
  mesh.merge();
  return m.Manifold.ofMesh(mesh);
}

/** Extract xyz positions (dropping extra vertex properties) and triangle indices. */
export function toArrays(solid: Manifold): MeshArrays {
  const mesh = solid.getMesh();
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = mesh.vertProperties[i * np];
    positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

/** Volume (mm³) and centroid of a closed triangle mesh via signed tetrahedra. */
export function massProps({ positions: p, indices: t }: MeshArrays): { volume: number; centroid: Vec3 } {
  let vol = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3;
    const b = t[i + 1] * 3;
    const c = t[i + 2] * 3;
    const v =
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
    vol += v;
    cx += v * (p[a] + p[b] + p[c]);
    cy += v * (p[a + 1] + p[b + 1] + p[c + 1]);
    cz += v * (p[a + 2] + p[b + 2] + p[c + 2]);
  }
  const d = vol === 0 ? 1 : 4 * vol;
  return { volume: vol, centroid: [cx / d, cy / d, cz / d] };
}

/** Printed volume and centroid of a surface sliced as a single wall of `thickness` (area-weighted). */
export function shellProps({ positions: p, indices: t }: MeshArrays, thickness: number): { volume: number; centroid: Vec3 } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3;
    const b = t[i + 1] * 3;
    const c = t[i + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const s = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    area += s;
    cx += (s * (p[a] + p[b] + p[c])) / 3;
    cy += (s * (p[a + 1] + p[b + 1] + p[c + 1])) / 3;
    cz += (s * (p[a + 2] + p[b + 2] + p[c + 2])) / 3;
  }
  const d = area || 1;
  return { volume: area * thickness, centroid: [cx / d, cy / d, cz / d] };
}
