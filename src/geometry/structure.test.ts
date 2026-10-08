import { beforeAll, describe, expect, it } from 'vitest';
import { computeLayout } from '../model/layout';
import { DEFAULT_PARAMS, type LampParams } from '../model/params';
import { buildStructure } from './structure';
import { loadManifold, type Manifold, type ManifoldToplevel } from './wasm';

/** Tripod with dowel legs: hollow base, 3 × Ø12.7 dowels, 0.4 mm clearance, 30 mm insertion. */
function dowelTripod(patch: (p: LampParams) => void = () => {}): LampParams {
  const p = structuredClone(DEFAULT_PARAMS);
  p.base.size = 140;
  p.base.height = 30;
  p.base.shellWall = 3;
  p.base.legs = 3;
  p.base.legKind = 'dowel';
  p.base.legHeight = 230;
  p.base.legSpread = 280;
  p.base.legRootRadius = 30;
  p.base.dowelDiameter = 12.7;
  p.base.dowelClearance = 0.4;
  p.base.dowelSocketDepth = 30;
  p.base.dowelSleeveWall = 3;
  p.stem.height = 0;
  p.quality.radialSegments = 96;
  patch(p);
  return p;
}

describe('dowel leg sockets', () => {
  let m: ManifoldToplevel;
  beforeAll(async () => {
    m = await loadManifold();
  });

  /** Volume of `solid` inside a small cube centred on `c` (0 = empty space there). */
  const occupancy = (solid: Manifold, c: [number, number, number], half = 0.3): number => {
    const probe = m.Manifold.cube([2 * half, 2 * half, 2 * half], true).translate(c);
    const v = solid.intersect(probe).volume();
    probe.delete();
    return v;
  };

  it('leaves an open bore of dowel + clearance along each leg axis to the insertion depth, with a solid floor', () => {
    const p = dowelTripod();
    const layout = computeLayout(p);
    const base = buildStructure(m, p, layout).find((s) => s.id === 'base')!;
    expect(base.solid.status()).toBe('NoError');
    expect(base.solid.genus()).toBeGreaterThanOrEqual(0);
    const rBore = (p.base.dowelDiameter + p.base.dowelClearance) / 2;
    expect(layout.legs).toHaveLength(3);
    for (const { top, tip } of layout.legs) {
      const axis = [tip[0] - top[0], tip[1] - top[1], tip[2] - top[2]];
      const len = Math.hypot(axis[0], axis[1], axis[2]);
      const u = axis.map((x) => x / len);
      const tilt = Math.acos(-u[2]);
      const along = (s: number, side = 0): [number, number, number] => {
        // offset sideways within the horizontal plane, perpendicular to the leg's azimuth
        const h = Math.hypot(u[0], u[1]);
        const n = [-u[1] / h, u[0] / h, 0];
        return [top[0] + u[0] * s + n[0] * side, top[1] + u[1] * s + n[1] * side, top[2] + u[2] * s];
      };
      const endInset = (p.base.dowelDiameter / 2) * Math.tan(tilt);
      // empty along the axis and at the dowel surface (r = dowel radius − probe), from the dowel end to the mouth
      for (let s = endInset + 1; s <= endInset + p.base.dowelSocketDepth; s += 2) {
        expect(occupancy(base.solid, along(s)), `axis at ${s.toFixed(1)}`).toBe(0);
        expect(occupancy(base.solid, along(s, p.base.dowelDiameter / 2 - 0.35)), `dowel surface at ${s.toFixed(1)}`).toBe(0);
        expect(occupancy(base.solid, along(s, -(p.base.dowelDiameter / 2 - 0.35)))).toBe(0);
      }
      // sleeve wall is material just outside the bore
      expect(occupancy(base.solid, along(endInset + 10, rBore + 1.2))).toBeGreaterThan(0);
      // socket floor (the base top skin) is solid above the axis top
      expect(occupancy(base.solid, [top[0], top[1], top[2] + 1])).toBeGreaterThan(0);
    }
  });
});
