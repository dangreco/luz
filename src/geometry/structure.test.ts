import { beforeAll, describe, expect, it } from 'vitest';
import { computeLayout, fastenerHole, screwLength } from '../model/layout';
import { socketPreset } from '../model/hardware';
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

describe('snap-in socket anti-rotation lugs', () => {
  let m: ManifoldToplevel;
  beforeAll(async () => {
    m = await loadManifold();
  });

  it('leaves two lugs in the plate hole at ±90° and keeps the hole open between them', () => {
    const p = structuredClone(DEFAULT_PARAMS);
    p.hardware.socketMount = 'snap';
    p.hardware.socket = socketPreset('E26', 'snap');
    p.stem.height = 0;
    p.quality.radialSegments = 96;
    const layout = computeLayout(p);
    const cup = buildStructure(m, p, layout).find((s) => s.id === 'cup')!;
    expect(cup.solid.status()).toBe('NoError');

    const sock = p.hardware.socket;
    const R = (sock.snapHoleDiameter + p.cup.clearance) / 2;
    const bite = Math.min(1.2, Math.max(0.4, (sock.snapHoleDiameter - sock.bodyDiameter) / 2 - 0.2));
    const rProbe = R - bite / 2;
    const z = layout.cupTop - p.cup.plateThickness / 2;
    const occ = (x: number, y: number): number => {
      const probe = m.Manifold.cube([0.4, 0.4, 0.4], true).translate(x, y, z);
      const v = cup.solid.intersect(probe).volume();
      probe.delete();
      return v;
    };
    expect(occ(layout.axisX, layout.axisY + rProbe)).toBeGreaterThan(0);
    expect(occ(layout.axisX, layout.axisY - rProbe)).toBeGreaterThan(0);
    expect(occ(layout.axisX + rProbe, layout.axisY)).toBe(0);
    expect(occ(layout.axisX - rProbe, layout.axisY)).toBe(0);
  });
});

describe('wiring bay with screwed cover', () => {
  let m: ManifoldToplevel;
  beforeAll(async () => {
    m = await loadManifold();
  });

  const occupancy = (solid: Manifold, c: [number, number, number], half = 0.3): number => {
    const probe = m.Manifold.cube([2 * half, 2 * half, 2 * half], true).translate(c);
    const v = solid.intersect(probe).volume();
    probe.delete();
    return v;
  };

  const bayLamp = (): LampParams => {
    const p = structuredClone(DEFAULT_PARAMS);
    p.hardware.wago.enabled = true;
    p.hardware.strainRelief.enabled = true;
    p.stem.height = 0;
    p.base.size = 170;
    p.base.height = 40;
    p.quality.radialSegments = 96;
    return p;
  };

  it('lays out a bay with no layout problems', () => {
    const layout = computeLayout(bayLamp());
    expect(layout.issues).toEqual([]);
    expect(layout.bay).not.toBeNull();
    expect(layout.clamp?.inBay).toBe(true);
  });

  it('cuts an open bay with solid sleeve walls, an open lever window, and a cover with 3 screw holes', () => {
    const p = bayLamp();
    const layout = computeLayout(p);
    const bay = layout.bay!;
    const parts = buildStructure(m, p, layout);
    const base = parts.find((s) => s.id === 'base')!;
    const cover = parts.find((s) => s.id === 'cover')!;
    expect(base.solid.status()).toBe('NoError');
    expect(cover.solid.status()).toBe('NoError');

    const zb = layout.baseBottom;
    const zc = zb + bay.depth; // ceiling underside
    // (a) the bay is empty away from the sleeves and bosses: lamp axis is the cord bore, so probe beside the cord
    // between the sleeves along the exit line
    const s0 = bay.sleeves[0];
    const across: [number, number] = [-s0.along[1], s0.along[0]];
    const mid: [number, number, number] = [
      layout.axisX + s0.along[0] * 2,
      layout.axisY + s0.along[1] * 2,
      zb + bay.depth / 2,
    ];
    expect(occupancy(base.solid, mid)).toBe(0);
    // (b) a sleeve side wall is material just outside the slot
    const wall: [number, number, number] = [
      s0.x + across[0] * (s0.wid / 2 + 1),
      s0.y + across[1] * (s0.wid / 2 + 1),
      zc - s0.hgt / 2,
    ];
    expect(occupancy(base.solid, wall)).toBeGreaterThan(0);
    // (c) the lever window is open: empty directly below the sleeve channel, at slot centre
    for (const s of bay.sleeves) {
      expect(occupancy(base.solid, [s.x, s.y, zc - s.hgt / 2])).toBe(0);
      expect(occupancy(base.solid, [s.x, s.y, zb + bay.coverThickness + 0.5])).toBe(0);
    }
    // the ceiling above the sleeve is material
    expect(occupancy(base.solid, [s0.x, s0.y, zc + 0.8])).toBeGreaterThan(0);
    // (d) cover: a solid disc with a clear hole at every screw centre
    expect(cover.solid.volume()).toBeGreaterThan(0);
    expect(bay.screws).toHaveLength(3);
    for (const s of bay.screws) {
      expect(occupancy(cover.solid, [s.x, s.y, zb + bay.coverThickness / 2])).toBe(0);
      // …and the boss above it is material with a pilot bore through its axis
      expect(occupancy(base.solid, [s.x + bay.hole.bossDiameter / 2 - 0.8, s.y, zb + bay.coverThickness + 1])).toBeGreaterThan(0);
    }
    expect(occupancy(cover.solid, [layout.axisX + 8, layout.axisY, zb + bay.coverThickness / 2])).toBeGreaterThan(0);
  });

  it('puts the felt-pad recesses on the cover instead of the base', () => {
    const p = bayLamp();
    const layout = computeLayout(p);
    const bay = layout.bay!;
    const parts = buildStructure(m, p, layout);
    const base = parts.find((s) => s.id === 'base')!;
    const cover = parts.find((s) => s.id === 'cover')!;
    expect(base.notes.some((n) => /Felt pads/.test(n))).toBe(false);
    expect(cover.notes.some((n) => /Felt pads: 3/.test(n))).toBe(true);
    // first pad sits on the exit line, inset from the cover edge: empty in the recess, material just above it
    const exitA = (p.base.cordExitAngle * Math.PI) / 180;
    const rc = (bay.diameter - 0.4) / 2 - Math.max(p.base.feetInset, p.base.feetDiameter / 2 + 2);
    const x = layout.axisX + Math.cos(exitA) * rc;
    const y = layout.axisY + Math.sin(exitA) * rc;
    const zb = layout.baseBottom;
    expect(occupancy(cover.solid, [x, y, zb + p.base.feetDepth / 2])).toBe(0);
    expect(occupancy(cover.solid, [x, y, zb + bay.coverThickness - 0.5])).toBeGreaterThan(0);
  });

  describe('heat-set insert bores', () => {
    const probe = (solid: Manifold, c: [number, number, number], half = 0.15): number => occupancy(solid, c, half);

    it('defaults to Voron M3×5×4 inserts with a clean layout', () => {
      const layout = computeLayout(bayLamp());
      const hole = layout.bay!.hole;
      expect(layout.issues).toEqual([]);
      expect(hole.kind).toBe('insert');
      expect(hole.diameter).toBe(4.6);
      expect(hole.depth).toBe(5);
      expect(hole.bossDiameter).toBeCloseTo(8.2, 6);
    });

    it('cuts an open, blind, chamfered bore with a printed wall at every bay boss and clamp screw', () => {
      const p = bayLamp();
      const layout = computeLayout(p);
      const bay = layout.bay!;
      const clamp = layout.clamp!;
      const base = buildStructure(m, p, layout).find((s) => s.id === 'base')!;
      expect(base.solid.status()).toBe('NoError');
      const across: [number, number] = [-clamp.along[1], clamp.along[0]];
      const sites: Array<{ x: number; y: number; mouth: number; hole: typeof bay.hole }> = [
        ...bay.screws.map((s) => ({ x: s.x, y: s.y, mouth: layout.baseBottom + bay.coverThickness, hole: bay.hole })),
        ...[-1, 1].map((side) => ({
          x: clamp.x + across[0] * clamp.screwOffset * side,
          y: clamp.y + across[1] * clamp.screwOffset * side,
          mouth: clamp.z + clamp.reach,
          hole: clamp.hole,
        })),
      ];
      expect(sites).toHaveLength(5);
      for (const { x, y, mouth, hole } of sites) {
        const r = hole.diameter / 2;
        // bore open, surrounded by printed wall
        expect(probe(base.solid, [x + r - 0.3, y, mouth + 2.5])).toBe(0);
        expect(probe(base.solid, [x + r + 0.6, y, mouth + 2.5])).toBeGreaterThan(0);
        // 45° lead-in: cone is open near the mouth, wall at the same radius higher up
        expect(probe(base.solid, [x + r + 0.25, y, mouth + 0.1], 0.05)).toBe(0);
        expect(probe(base.solid, [x + r + 0.25, y, mouth + 1.5], 0.05)).toBeGreaterThan(0);
        // blind: material above the bore end
        expect(probe(base.solid, [x, y, mouth + hole.depth + 0.6])).toBeGreaterThan(0);
      }
    });

    it('keeps small Ø0.8·d pilots in self-tapping mode', () => {
      const p = bayLamp();
      p.hardware.fastening = 'selfTap';
      const layout = computeLayout(p);
      const bay = layout.bay!;
      const base = buildStructure(m, p, layout).find((s) => s.id === 'base')!;
      expect(base.solid.status()).toBe('NoError');
      expect(bay.hole.kind).toBe('selfTap');
      expect(bay.hole.diameter).toBeCloseTo(2.4, 6);
      const mouth = layout.baseBottom + bay.coverThickness;
      for (const s of bay.screws) {
        expect(probe(base.solid, [s.x, s.y, mouth + 2])).toBe(0);
        expect(probe(base.solid, [s.x + 1.5, s.y, mouth + 2])).toBeGreaterThan(0);
      }
    });

    it('picks stock M3 lengths for inserts and a ceil(grip + depth − 1) screw for self-tapping', () => {
      const hw = DEFAULT_PARAMS.hardware;
      const insert = fastenerHole(hw, 3);
      expect(screwLength(insert, 2.4, 4)).toBe(6);
      expect(screwLength(insert, 6.8, 4)).toBe(10);
      const selfTap = fastenerHole({ ...hw, fastening: 'selfTap' }, 3);
      expect(screwLength(selfTap, 2.4, 4)).toBe(10);
    });
  });
});
