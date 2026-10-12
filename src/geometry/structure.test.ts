import { beforeAll, describe, expect, it } from 'vitest';
import { computeLayout, fastenerHole, screwLength } from '../model/layout';
import { socketPreset } from '../model/hardware';
import { DEFAULT_PARAMS, type LampParams } from '../model/params';
import { sectionRadius } from '../model/section';
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

describe('snap-in socket wing slots', () => {
  let m: ManifoldToplevel;
  beforeAll(async () => {
    m = await loadManifold();
  });

  it('flanks each spring wing with a full-height rib pair, leaving the wing slot and the body path open', () => {
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
    const bite = Math.min(1.6, Math.max(0.4, (sock.snapHoleDiameter - sock.bodyDiameter) / 2 - 0.6));
    const edge = sock.wingWidth / 2 + sock.wingTolerance; // slot half-width
    const xIn = Math.sqrt((R - bite) ** 2 - (edge + 2) ** 2); // rib inner face
    const occ = (x: number, y: number, z: number): number => {
      const probe = m.Manifold.cube([0.4, 0.4, 0.4], true).translate(layout.axisX + x, layout.axisY + y, z);
      const v = cup.solid.intersect(probe).volume();
      probe.delete();
      return v;
    };
    // plate, and the lower cavity wall down to the top of the straight bore
    const zPlate = layout.cupTop - p.cup.plateThickness / 2;
    const zWall = layout.cupTop - p.cup.plateThickness - 6;
    for (const z of [zPlate, zWall]) {
      for (const sx of [-1, 1]) {
        const x = sx * (xIn + 0.5);
        // both ribs of the pair stand inside the hole…
        expect(occ(x, edge + 1, z)).toBeGreaterThan(0);
        expect(occ(x, -edge - 1, z)).toBeGreaterThan(0);
        // …and the wing slot between them is open
        expect(occ(x, 0, z)).toBe(0);
        expect(occ(x, edge - 0.4, z)).toBe(0);
      }
      // the socket body passes at the diagonals and at ±Y
      const d = (R - bite - 0.3) * Math.SQRT1_2;
      expect(occ(d, d, z)).toBe(0);
      expect(occ(-d, -d, z)).toBe(0);
      expect(occ(0, R - bite - 0.3, z)).toBe(0);
      expect(occ(0, -(R - bite - 0.3), z)).toBe(0);
    }
  });

  it('sizes the slot from wing width + tolerance', () => {
    const p = structuredClone(DEFAULT_PARAMS);
    p.hardware.socketMount = 'snap';
    p.hardware.socket = { ...socketPreset('E26', 'snap'), wingWidth: 12, wingTolerance: 0.2 };
    p.stem.height = 0;
    p.quality.radialSegments = 96;
    const layout = computeLayout(p);
    const cup = buildStructure(m, p, layout).find((s) => s.id === 'cup')!;
    const sock = p.hardware.socket;
    const R = (sock.snapHoleDiameter + p.cup.clearance) / 2;
    const bite = Math.min(1.6, Math.max(0.4, (sock.snapHoleDiameter - sock.bodyDiameter) / 2 - 0.6));
    const edge = 6.2;
    const xIn = Math.sqrt((R - bite) ** 2 - (edge + 2) ** 2);
    const z = layout.cupTop - p.cup.plateThickness / 2;
    const occ = (y: number): number => {
      const probe = m.Manifold.cube([0.4, 0.4, 0.4], true).translate(layout.axisX + xIn + 0.5, layout.axisY + y, z);
      const v = cup.solid.intersect(probe).volume();
      probe.delete();
      return v;
    };
    expect(occ(5.5)).toBe(0); // inside the 12.4 mm slot
    expect(occ(edge + 1)).toBeGreaterThan(0); // first rib
  });
});

describe('cup overhang', () => {
  let m: ManifoldToplevel;
  beforeAll(async () => {
    m = await loadManifold();
  });

  it('keeps the cavity flare within 45° of vertical', () => {
    const p = structuredClone(DEFAULT_PARAMS);
    p.hardware.socketMount = 'snap';
    p.hardware.socket = socketPreset('E26', 'snap');
    p.stem.height = 0;
    p.quality.radialSegments = 96;
    const layout = computeLayout(p);
    const cup = buildStructure(m, p, layout).find((s) => s.id === 'cup')!;
    expect(cup.solid.status()).toBe('NoError');
    expect(cup.notes.some((n) => /flare is steep/.test(n))).toBe(false);
  });
});

describe('split wiring base (tray + deck)', () => {
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

  const build = (p: LampParams = bayLamp()) => {
    const layout = computeLayout(p);
    const parts = buildStructure(m, p, layout);
    const tray = parts.find((s) => s.id === 'base' && s.label === 'Base tray')!;
    const deck = parts.find((s) => s.id === 'base' && s.label === 'Base deck')!;
    const cup = parts.find((s) => s.id === 'cup')!;
    return { p, layout, bay: layout.bay!, parts, tray, deck, cup };
  };

  it('lays out a bay with no layout problems', () => {
    const layout = computeLayout(bayLamp());
    expect(layout.issues).toEqual([]);
    expect(layout.bay).not.toBeNull();
    expect(layout.clamp?.inBay).toBe(true);
  });

  it('splits the base into a tray and a deck at the deck underside, with no cover part', () => {
    const { layout, bay, parts, tray, deck } = build();
    expect(parts.filter((s) => s.id === 'base').map((s) => s.label)).toEqual(['Base tray', 'Base deck']);
    expect(parts.some((s) => (s.id as string) === 'cover')).toBe(false);
    expect(tray.solid.status()).toBe('NoError');
    expect(deck.solid.status()).toBe('NoError');
    const split = layout.baseBottom + bay.depth;
    expect(tray.solid.boundingBox().max[2]).toBeCloseTo(split, 3);
    expect(deck.solid.boundingBox().min[2]).toBeCloseTo(split, 3);
    expect(deck.printFlip).toBe(true);
    expect(tray.printFlip).toBe(false);
  });

  it('stands the sleeves on the tray floor with solid walls and an open lever window above', () => {
    const { layout, bay, tray } = build();
    const zf = layout.baseBottom + bay.floor;
    const s0 = bay.sleeves[0];
    const across: [number, number] = [-s0.along[1], s0.along[0]];
    // the cord path between the sleeves is open
    expect(occupancy(tray.solid, [layout.axisX + s0.along[0] * 2, layout.axisY + s0.along[1] * 2, zf + 3])).toBe(0);
    for (const s of bay.sleeves) {
      for (const side of [-1, 1]) {
        // side wall just outside the slot is material
        expect(occupancy(tray.solid, [s.x + side * across[0] * (s.wid / 2 + 1), s.y + side * across[1] * (s.wid / 2 + 1), zf + s.hgt / 2])).toBeGreaterThan(0);
      }
      // slot is empty, open above the sleeve, with the floor under it
      expect(occupancy(tray.solid, [s.x, s.y, zf + s.hgt / 2])).toBe(0);
      expect(occupancy(tray.solid, [s.x, s.y, zf + s.hgt + 0.5])).toBe(0);
      expect(occupancy(tray.solid, [s.x, s.y, zf - 1])).toBeGreaterThan(0);
    }
  });

  it('grips the connector with 0.5 mm ribs that interfere 0.25 mm per side', () => {
    const { layout, bay, tray } = build();
    const zf = layout.baseBottom + bay.floor;
    const s = bay.sleeves[0];
    const across: [number, number] = [-s.along[1], s.along[0]];
    // a rib sits inside the slot wall line: material 0.2 mm in from the slot face, empty 0.8 mm in
    const at = (lc: number): [number, number, number] => [s.x + across[0] * lc, s.y + across[1] * lc, zf + 2];
    expect(occupancy(tray.solid, at(s.wid / 2 - 0.2), 0.05)).toBeGreaterThan(0);
    expect(occupancy(tray.solid, at(s.wid / 2 - 0.8), 0.05)).toBe(0);
  });

  it('spaces the sleeves clear of the cup spigot', () => {
    const { p, layout, bay, tray, cup } = build();
    const zf = layout.baseBottom + bay.floor;
    const s = bay.sleeves[0];
    const across: [number, number] = [-s.along[1], s.along[0]];
    const off = Math.hypot(s.x - layout.axisX, s.y - layout.axisY);
    const innerFace = off - s.wid / 2 - 2; // SLEEVE_WALL
    expect(innerFace).toBeGreaterThanOrEqual(bay.spigotRadius + 1 - 1e-6);
    // the spigot is wide enough for the inserts and fills out to spigotRadius
    expect(occupancy(cup.solid, [layout.axisX + across[0] * (bay.spigotRadius - 0.5), layout.axisY + across[1] * (bay.spigotRadius - 0.5), bay.cupScrewMouthZ + 1])).toBeGreaterThan(0);
    // tray between the spigot and each sleeve is empty; the sleeve wall beyond the slot is material
    for (const side of [-1, 1]) {
      expect(occupancy(tray.solid, [layout.axisX + side * across[0] * (bay.spigotRadius + 0.5), layout.axisY + side * across[1] * (bay.spigotRadius + 0.5), zf + 4])).toBe(0);
      expect(occupancy(tray.solid, [layout.axisX + side * across[0] * (off + s.wid / 2 + 1), layout.axisY + side * across[1] * (off + s.wid / 2 + 1), zf + 4])).toBeGreaterThan(0);
    }
    expect(p.hardware.wago.clearance).toBeGreaterThan(0);
  });

  it('clamps the cup with 4 screws: insert bores in the spigot, clearance holes through the tray floor', () => {
    const { layout, bay, tray, cup } = build();
    expect(bay.screws).toHaveLength(4);
    const zb = layout.baseBottom;
    for (const s of bay.screws) {
      expect(occupancy(cup.solid, [s.x, s.y, bay.cupScrewMouthZ + 2.5], 0.15)).toBe(0);
      expect(occupancy(cup.solid, [s.x + 2.4, s.y, bay.cupScrewMouthZ + 2.5], 0.15)).toBeGreaterThan(0);
      // blind: material above the insert bore
      expect(occupancy(cup.solid, [s.x, s.y, bay.cupScrewMouthZ + bay.hole.depth + 0.6], 0.15)).toBeGreaterThan(0);
      // tray: Ø3.4 clearance through the floor and the pillar, printed wall beside it
      expect(occupancy(tray.solid, [s.x, s.y, zb + bay.floor / 2], 0.15)).toBe(0);
      expect(occupancy(tray.solid, [s.x, s.y, bay.cupScrewMouthZ - 2], 0.15)).toBe(0);
      expect(occupancy(tray.solid, [s.x + 3, s.y, zb + bay.floor / 2], 0.15)).toBeGreaterThan(0);
      expect(occupancy(tray.solid, [s.x + 3, s.y, bay.cupScrewMouthZ - 2], 0.15)).toBeGreaterThan(0);
    }
    // the pillar tops stop just under the spigot end face
    const s = bay.screws[0];
    expect(occupancy(tray.solid, [s.x + 3, s.y, bay.cupScrewMouthZ - 0.1], 0.05)).toBe(0);
    expect(occupancy(tray.solid, [s.x + 3, s.y, bay.cupScrewMouthZ - 0.5], 0.05)).toBeGreaterThan(0);
  });

  it('puts the felt-pad recesses on the tray floor', () => {
    const { p, layout, bay, tray, deck } = build();
    expect(deck.notes.some((n) => /Felt pads/.test(n))).toBe(false);
    expect(tray.notes.some((n) => /Felt pads: 3/.test(n))).toBe(true);
    // first pad is at angle 0 on the underside, inset from the base edge
    const rc = sectionRadius(p.base.section, 0) * p.base.size - p.base.feetInset;
    const x = rc;
    const y = 0;
    const zb = layout.baseBottom;
    expect(occupancy(tray.solid, [x, y, zb + p.base.feetDepth / 2])).toBe(0);
    expect(occupancy(tray.solid, [x, y, zb + bay.floor - 0.5])).toBeGreaterThan(0);
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

    it('cuts an open, blind, chamfered bore with a printed wall at every cup screw and clamp pedestal', () => {
      const { layout, bay, tray, cup } = build();
      expect(tray.solid.status()).toBe('NoError');
      expect(cup.solid.status()).toBe('NoError');
      const clamp = layout.clamp!;
      const across: [number, number] = [-clamp.along[1], clamp.along[0]];
      const pedestalTop = clamp.z + clamp.reach;
      // cup sites open downward from the spigot end face; clamp sites open upward from the pedestal top
      const downSites = bay.screws.map((s) => ({ x: s.x, y: s.y, mouth: bay.cupScrewMouthZ, hole: bay.hole }));
      const upSites = [-1, 1].map((side) => ({
        x: clamp.x + across[0] * clamp.screwOffset * side,
        y: clamp.y + across[1] * clamp.screwOffset * side,
        top: pedestalTop,
        hole: clamp.hole,
      }));
      for (const { x, y, mouth, hole } of downSites) {
        const r = hole.diameter / 2;
        expect(probe(cup.solid, [x + r - 0.3, y, mouth + 2.5])).toBe(0);
        expect(probe(cup.solid, [x + r + 0.6, y, mouth + 2.5])).toBeGreaterThan(0);
        expect(probe(cup.solid, [x + r + 0.25, y, mouth + 0.1], 0.05)).toBe(0);
        expect(probe(cup.solid, [x + r + 0.25, y, mouth + 1.5], 0.05)).toBeGreaterThan(0);
        expect(probe(cup.solid, [x, y, mouth + hole.depth + 0.6])).toBeGreaterThan(0);
      }
      for (const { x, y, top, hole } of upSites) {
        const r = hole.diameter / 2;
        expect(probe(tray.solid, [x + r - 0.3, y, top - 2.5])).toBe(0);
        expect(probe(tray.solid, [x + r + 0.6, y, top - 2.5])).toBeGreaterThan(0);
        // 45° lead-in at the pedestal top
        expect(probe(tray.solid, [x + r + 0.25, y, top - 0.1], 0.05)).toBe(0);
        expect(probe(tray.solid, [x + r + 0.25, y, top - 1.5], 0.05)).toBeGreaterThan(0);
        // blind: material under the bore end
        expect(probe(tray.solid, [x, y, top - hole.depth - 0.6])).toBeGreaterThan(0);
      }
    });

    it('keeps small Ø0.8·d pilots in self-tapping mode', () => {
      const p = bayLamp();
      p.hardware.fastening = 'selfTap';
      const { layout, bay, cup } = build(p);
      expect(layout.issues).toEqual([]);
      expect(cup.solid.status()).toBe('NoError');
      expect(bay.hole.kind).toBe('selfTap');
      expect(bay.hole.diameter).toBeCloseTo(2.4, 6);
      for (const s of bay.screws) {
        expect(probe(cup.solid, [s.x, s.y, bay.cupScrewMouthZ + 2])).toBe(0);
        expect(probe(cup.solid, [s.x + 1.5, s.y, bay.cupScrewMouthZ + 2])).toBeGreaterThan(0);
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
