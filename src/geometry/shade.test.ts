import { beforeAll, describe, expect, it } from 'vitest';
import { computeLayout } from '../model/layout';
import { DEFAULT_PARAMS, type LampParams } from '../model/params';
import { toArrays } from './mesh';
import { buildShadeParts } from './shade';
import { loadManifold } from './wasm';
import type { ManifoldToplevel } from './wasm';

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
    for (const style of ['ribs', 'wovenTexture', 'basket'] as const) {
      const p = params((q) => {
        q.shade.style = style;
        q.shade.mount = 'fitter';
        q.shade.twist = 40;
        q.shade.profile = 'bulge';
        q.shade.bulge = 0.12;
        q.shade.ribCorrugated = true;
        q.shade.ribTwist = 60;
        q.shade.bottomSection = { ...roundedTri };
        q.shade.topSection = { ...roundedTri };
      });
      const { worst, volume } = worstViolation(p);
      expect(worst, `${style} inner wall violation`).toBeLessThanOrEqual(0.001);
      expect(volume, `${style} volume`).toBeGreaterThan(1000);
    }
  });
});
