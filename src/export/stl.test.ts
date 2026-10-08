import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { PartId, PartMesh } from '../geometry/build';
import { massProps, toArrays, type MeshArrays, type Vec3 } from '../geometry/mesh';
import { loadManifold } from '../geometry/wasm';
import type { MaterialId } from '../model/params';
import { stlZip } from './zip';
import { to3mf } from './threemf';
import { toBinaryStl } from './stl';

/** Wound tetrahedron around the origin — a known 4-triangle closed solid. */
function tetra(offset: Vec3): MeshArrays {
  const positions = new Float32Array([
    0 + offset[0], 0 + offset[1], 0 + offset[2],
    10 + offset[0], 0 + offset[1], 0 + offset[2],
    0 + offset[0], 10 + offset[1], 0 + offset[2],
    0 + offset[0], 0 + offset[1], 10 + offset[2],
  ]);
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  return { positions, indices };
}

function bbox(mesh: MeshArrays): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], mesh.positions[i + k]);
      max[k] = Math.max(max[k], mesh.positions[i + k]);
    }
  }
  return { min, max };
}

function part(id: PartId, label: string, mesh: MeshArrays, material: MaterialId, printFlip: boolean): PartMesh {
  const { volume, centroid } = massProps(mesh);
  const box = bbox(mesh);
  return {
    id,
    label,
    material,
    mesh,
    printFlip,
    volume,
    mass: (volume / 1000) * 1.24,
    centroid,
    bbox: box,
    notes: ['test note'],
  };
}

function triangleCount(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
}

/** The NUL-padded 80-byte STL header as text. */
function headerOf(stl: Uint8Array): string {
  return new TextDecoder().decode(stl.slice(0, 80)).replace(/\0.*$/, '');
}

describe('toBinaryStl', () => {
  it('writes 84 + 50 × triangles bytes with a "Luz <name>" header', () => {
    const mesh = tetra([0, 0, 0]);
    const stl = toBinaryStl(mesh, false, 'Base');
    expect(stl.length).toBe(84 + 50 * 4);
    expect(triangleCount(stl)).toBe(4);
    expect(headerOf(stl)).toBe('Luz Base');
  });

  it('computes unit facet normals little-endian', () => {
    const stl = toBinaryStl(tetra([0, 0, 0]), false);
    const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    for (let i = 0; i < 4; i++) {
      const nx = dv.getFloat32(84 + i * 50, true);
      const ny = dv.getFloat32(84 + i * 50 + 4, true);
      const nz = dv.getFloat32(84 + i * 50 + 8, true);
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
    }
  });

  it('flips 180° about X and drops the part so min z = 0', () => {
    // tetrahedron floating at z ∈ [10, 20] and y ∈ [−30, −20]
    const mesh = tetra([0, -30, 10]);
    const stl = toBinaryStl(mesh, true);
    const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 4; i++) {
      for (let v = 0; v < 3; v++) {
        const base = 84 + i * 50 + 12 + v * 12;
        const y = dv.getFloat32(base + 4, true);
        const z = dv.getFloat32(base + 8, true);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    expect(minZ).toBeCloseTo(0, 4);
    expect(maxZ).toBeCloseTo(10, 4); // 20 − 10 after the X rotation
    expect(minY).toBeCloseTo(20, 4); // −(−30) after the rotation
    expect(maxY).toBeCloseTo(30, 4);
  });

  it('drops un-flipped parts onto the bed too', () => {
    const stl = toBinaryStl(tetra([5, 5, 33]), false);
    const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    let minZ = Infinity;
    for (let i = 0; i < 4; i++)
      for (let v = 0; v < 3; v++) minZ = Math.min(minZ, dv.getFloat32(84 + i * 50 + 12 + v * 12 + 8, true));
    expect(minZ).toBeCloseTo(0, 4);
  });
});

describe('stlZip', () => {
  it('zips one STL per part plus a README listing material, mass and orientation', () => {
    const parts = [part('base', 'Base', tetra([0, 0, 0]), 'PLA', false), part('cup', 'Socket cup', tetra([0, 0, 5]), 'PETG', true)];
    const zip = unzipSync(stlZip(parts, 'My Lamp'));
    expect(Object.keys(zip).sort()).toEqual(['My Lamp-base.stl', 'My Lamp-cup.stl', 'README.txt']);

    const stl = zip['My Lamp-base.stl'];
    expect(headerOf(stl)).toBe('Luz My Lamp Base');

    const readme = strFromU8(zip['README.txt']);
    expect(readme).toContain('My Lamp-base.stl — Base');
    expect(readme).toContain('PLA (HDT 55');
    expect(readme).toContain('flipped 180° about X'); // cup
    expect(readme).toContain('as modelled'); // base
    expect(readme).toContain('test note');
    expect(readme).toContain('cUL/CSA-listed');
  });
});

describe('to3mf', () => {
  it('builds a valid OPC package with one model object and build item per part', async () => {
    const m = await loadManifold();
    const solidA = m.Manifold.cube([30, 20, 10]).translate(0, 0, 100); // z ∈ [100, 110]
    const solidB = m.Manifold.cube([40, 20, 10]).translate(100, 0, -5); // z ∈ [-5, 5]
    const meshA = toArrays(solidA);
    const meshB = toArrays(solidB);
    const parts = [part('base', 'Base', meshA, 'PLA', false), part('stem', 'Stem', meshB, 'PLA', true)];
    solidA.delete();
    solidB.delete();

    const zip = unzipSync(to3mf(parts));
    expect(Object.keys(zip).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = strFromU8(zip['3D/3dmodel.model']);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('http://schemas.microsoft.com/3dmanufacturing/core/2015/02');
    expect(model.match(/<object /g)).toHaveLength(2);
    expect(model.match(/<item /g)).toHaveLength(2);
    expect(model.match(/<vertex /g)).toHaveLength(meshA.positions.length / 3 + meshB.positions.length / 3);
    expect(model.match(/<triangle /g)).toHaveLength(
      meshA.indices.length / 3 + meshB.indices.length / 3,
    );
    expect(strFromU8(zip['[Content_Types].xml'])).toContain('3dmanufacturing-3dmodel+xml');
    expect(strFromU8(zip['_rels/.rels'])).toContain('/3D/3dmodel.model');
  });

  it('lays parts out along X with 10 mm gaps and prints at min z = 0', async () => {
    const m = await loadManifold();
    const a = toArrays(m.Manifold.cube([30, 20, 10]).translate(0, 0, 100));
    const b = toArrays(m.Manifold.cube([40, 20, 10]).translate(500, 0, 0));
    const parts = [part('base', 'Base', a, 'PLA', false), part('stem', 'Stem', b, 'PLA', false)];
    const model = strFromU8(unzipSync(to3mf(parts))['3D/3dmodel.model']);

    const transforms = [...model.matchAll(/transform="([^"]+)"/g)].map((mm) =>
      mm[1].split(' ').map(Number),
    );
    expect(transforms).toHaveLength(2);
    const tx0 = transforms[0][9];
    const tx1 = transforms[1][9];
    // first part starts at x = 0; part 2's left edge (orig x = 500) sits 10 mm after part 1's right edge
    expect(tx0).toBeCloseTo(0, 3);
    expect(tx1 + 500 - (tx0 + 30)).toBeCloseTo(10, 3);
    // every vertex sits at z ≥ 0 after the transform, and the lowest is on the bed
    const objects = model.split('<object ');
    let minZ = Infinity;
    objects[1].replace(/z="(-?[0-9.]+)"/g, (_, z) => {
      minZ = Math.min(minZ, Number(z) + transforms[0][11]);
      return _;
    });
    expect(minZ).toBeCloseTo(0, 3);
  });
});

