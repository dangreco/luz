import type { MeshArrays } from '../geometry/mesh';

/**
 * Binary STL, little-endian, millimetres. Facet normals are computed from the triangle winding.
 * When `flip` is set the part is rotated 180° about X (as-is for parts that print upside-down) and
 * every export is dropped onto the bed so min z = 0. Header: "Luz <name>".
 */
export function toBinaryStl(mesh: MeshArrays, flip: boolean, name = ''): Uint8Array {
  const { positions, indices } = mesh;
  const tris = indices.length / 3;
  if (!Number.isInteger(tris)) throw new Error('Mesh index count is not a multiple of 3');
  const out = new Uint8Array(84 + tris * 50);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const header = `Luz${name ? ` ${name}` : ''}`.slice(0, 79);
  out.set(new TextEncoder().encode(header), 0);
  dv.setUint32(80, tris, true);

  // min z after the optional 180° X rotation, so the part sits on the bed
  let minZ = Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    const z = flip ? -positions[i] : positions[i];
    if (z < minZ) minZ = z;
  }
  if (!Number.isFinite(minZ)) minZ = 0;

  let o = 84;
  for (let i = 0; i < indices.length; i += 3) {
    const v: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const j = indices[i + k] * 3;
      const x = positions[j];
      const y = flip ? -positions[j + 1] : positions[j + 1];
      const z = (flip ? -positions[j + 2] : positions[j + 2]) - minZ;
      v.push([x, y, z]);
    }
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
    const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = ny = nz = 0;
    }
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const p of v) {
      dv.setFloat32(o, p[0], true);
      dv.setFloat32(o + 4, p[1], true);
      dv.setFloat32(o + 8, p[2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return out;
}
