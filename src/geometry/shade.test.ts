import { beforeAll, describe, expect, it } from 'vitest';
import { computeLayout } from '../model/layout';
import { DEFAULT_PARAMS, type LampParams } from '../model/params';
import { toArrays } from './mesh';
import { buildShadeParts } from './shade';
import { loadManifold } from './wasm';
import type { Manifold, ManifoldToplevel } from './wasm';

/**
 * Regression guard for the invariant the whole safety stack relies on: whatever the
 * surface style or mount does, the meshed inner wall never comes closer to the axis
 * than the nominal innerRadius (− 0.05 mm sampling tolerance). Covers the paths that
 * have historically dipped inside: corrugated ribs, the fitter seat groove/lip, the
 * basket weave and rim bands, and the woven relief.
 */
describe('shade inner wall', () => {
  let m: ManifoldToplevel;

  beforeAll(async () => {
    m = await loadManifold();
  });

  const params = (patch: (p: LampParams) => void): LampParams => {
    const p = structuredClone(DEFAULT_PARAMS);
    patch(p);
    return p;
  };

  const worstViolation = (p: LampParams): { worst: number; volume: number } => {
    const layout = computeLayout(p);
    const [shade] = buildShadeParts(m, p, layout);
    expect(shade.solid.status()).toBe('NoError');
    const { positions } = toArrays(shade.solid);
    const S = layout.shade;
    let worst = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i] - layout.axisX, positions[i + 1] - layout.axisY);
      const t = Math.min(1, Math.max(0, (positions[i + 2] - layout.shadeBottom) / S.height));
      const allowed = S.innerRadius(t, Math.atan2(positions[i + 1] - layout.axisY, positions[i] - layout.axisX)) - 0.05;
      if (r < allowed && allowed - r > worst) worst = allowed - r;
    }
    return { worst, volume: shade.solid.volume() };
  };

  it('styles with displacement stay outside the nominal inner wall', () => {
    const roundedTri = { kind: 'polygon' as const, sides: 3, cornerRadius: 0.35, exponent: 4, aspect: 1, rotation: 0 };
    // tightest case: faceted triangle section, twist, bulge, fitter groove
    for (const style of ['ribs', 'textured', 'basket'] as const) {
      const p = params((q) => {
        q.shade.style = style;
        q.shade.mount = 'fitter';
        q.shade.twist = 40;
        q.shade.profile = 'bulge';
        q.shade.bulge = 0.12;
        q.shade.ribCorrugated = true;
        q.shade.ribTwist = 60;
        q.shade.texture = { pattern: 'knurl', columns: 40, rows: 30, depth: 1.2, twist: 30 };
        q.shade.rippleCount = 5;
        q.shade.topRounding = 25;
        q.shade.bottomSection = { ...roundedTri };
        q.shade.topSection = { ...roundedTri };
      });
      const { worst, volume } = worstViolation(p);
      expect(worst, `${style} inner wall violation`).toBeLessThanOrEqual(0.001);
      expect(volume, `${style} volume`).toBeGreaterThan(1000);
    }
  });
});

describe('diffuser liner', () => {
  let m: ManifoldToplevel;
  beforeAll(async () => {
    m = await loadManifold();
  });

  it('is a constant-radius tube inside the shade band, between its seat and top', () => {
    const p = structuredClone(DEFAULT_PARAMS);
    p.shade.mount = 'spider';
    p.shade.topClosure = 'open';
    p.shade.diffuser.position = 'liner';
    const layout = computeLayout(p);
    expect(layout.liner).not.toBeNull();
    const liner = layout.liner!;
    const part = buildShadeParts(m, p, layout).find((s) => s.id === 'diffuser');
    expect(part).toBeDefined();
    expect(part!.solid.status()).toBe('NoError');
    // the narrowest shade wall over the liner's band bounds the liner from outside
    let minInner = Infinity;
    for (let i = 0; i <= 24; i++)
      for (let k = 0; k < 72; k++)
        minInner = Math.min(minInner, layout.shade.innerRadius((i / 24), (k / 72) * Math.PI * 2));
    const t = p.shade.diffuser.thickness;
    const { positions } = toArrays(part!.solid);
    let rMax = 0;
    let rMin = Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i] - layout.axisX, positions[i + 1] - layout.axisY);
      rMax = Math.max(rMax, r);
      rMin = Math.min(rMin, r);
      zMin = Math.min(zMin, positions[i + 2]);
      zMax = Math.max(zMax, positions[i + 2]);
    }
    // mesh positions are float32: ~1e-5 mm resolution at these radii
    const eps = 1e-4;
    expect(rMax).toBeLessThanOrEqual(minInner - p.shade.diffuser.gap + eps);
    expect(rMax).toBeCloseTo(liner.outerR, 3);
    // the stepped-in foot is the thinnest part of the radial span: half a wall inboard
    expect(rMin).toBeGreaterThanOrEqual(liner.outerR - 1.5 * t - eps);
    expect(zMin).toBeGreaterThanOrEqual(liner.seatZ - eps);
    expect(zMax).toBeLessThanOrEqual(liner.topZ + eps);
  });
});

describe('voronoi perforation', () => {
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

  it('leaves closed solid rims of perfMargin at the bottom and top', () => {
    for (const seed of [7, 1, 42]) {
      const p = structuredClone(DEFAULT_PARAMS);
      p.shade.style = 'perforated';
      p.shade.perfPattern = 'voronoi';
      p.shade.perfSeed = seed;
      p.shade.topClosure = 'open';
      p.shade.mount = 'spider';
      const layout = computeLayout(p);
      const [shade] = buildShadeParts(m, p, layout);
      expect(shade.solid.status()).toBe('NoError');
      const S = layout.shade;
      const rims = [
        ['bottom', layout.shadeBottom + p.shade.perfMargin / 2],
        ['top', layout.shadeTop - p.shade.perfMargin / 2],
      ] as const;
      for (const [label, z] of rims) {
        const t = (z - layout.shadeBottom) / S.height;
        for (let k = 0; k < 120; k++) {
          const phi = (k / 120) * Math.PI * 2;
          const r = (S.innerRadius(t, phi) + S.outerRadius(t, phi)) / 2;
          const v = occupancy(shade.solid, [layout.axisX + r * Math.cos(phi), layout.axisY + r * Math.sin(phi), z]);
          expect(v, `seed ${seed} ${label} rim open at ${phi.toFixed(2)}`).toBeGreaterThan(0);
        }
      }
      // the lattice actually cut something
      const smooth = structuredClone(p);
      smooth.shade.style = 'smooth';
      const [plain] = buildShadeParts(m, smooth, computeLayout(smooth));
      expect(shade.solid.volume()).toBeLessThan(plain.solid.volume());
    }
  });

  it('raises cells by random depths up to perfProtrusion without touching the inner wall', () => {
    const P = 3;
    for (const seed of [7, 42]) {
      const p = structuredClone(DEFAULT_PARAMS);
      p.shade.style = 'perforated';
      p.shade.perfPattern = 'voronoi';
      p.shade.perfSeed = seed;
      p.shade.perfProtrusion = P;
      p.shade.topClosure = 'open';
      p.shade.mount = 'fitter';
      const layout = computeLayout(p);
      const [shade] = buildShadeParts(m, p, layout);
      expect(shade.solid.status()).toBe('NoError');
      const S = layout.shade;
      const { positions } = toArrays(shade.solid);
      let maxProud = 0;
      let worstInner = 0;
      for (let i = 0; i < positions.length; i += 3) {
        const dx = positions[i] - layout.axisX;
        const dy = positions[i + 1] - layout.axisY;
        const t = Math.min(1, Math.max(0, (positions[i + 2] - layout.shadeBottom) / S.height));
        const phi = Math.atan2(dy, dx);
        maxProud = Math.max(maxProud, Math.hypot(dx, dy) - S.outerRadius(t, phi));
        worstInner = Math.max(worstInner, S.innerRadius(t, phi) - 0.05 - Math.hypot(dx, dy));
      }
      expect(maxProud, `seed ${seed} deepest tile`).toBeGreaterThan(P * 0.5);
      expect(maxProud, `seed ${seed} tile overshoot`).toBeLessThanOrEqual(P + 0.05);
      expect(worstInner, `seed ${seed} inner wall`).toBeLessThanOrEqual(0.001);
    }
  });
});
