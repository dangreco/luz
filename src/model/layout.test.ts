import { describe, expect, it } from 'vitest';
import { computeLayout, shadeBulbClearance } from './layout';
import { DEFAULT_PARAMS, type LampParams } from './params';
import { sectionRadius, sectionRing, angles } from './section';

const params = (patch: (p: LampParams) => void): LampParams => {
  const p = structuredClone(DEFAULT_PARAMS);
  patch(p);
  return p;
};

describe('sectionRadius', () => {
  it('polygon has circumradius at vertices and apothem at edge midpoints', () => {
    const sq = { kind: 'polygon' as const, sides: 4, cornerRadius: 0, exponent: 4, aspect: 1, rotation: 0 };
    expect(sectionRadius(sq, 0)).toBeCloseTo(0.5, 6);
    expect(sectionRadius(sq, Math.PI / 4)).toBeCloseTo(0.5 * Math.cos(Math.PI / 4), 6);
  });

  it('fully rounded polygon becomes its inscribed circle', () => {
    const tri = { kind: 'polygon' as const, sides: 3, cornerRadius: 1, exponent: 4, aspect: 1, rotation: 0 };
    for (const phi of [0, 0.3, 1, 2, 4]) expect(sectionRadius(tri, phi)).toBeCloseTo(0.25, 6);
  });

  it('aspect stretches the y extent', () => {
    const el = { kind: 'circle' as const, sides: 3, cornerRadius: 0, exponent: 2, aspect: 2, rotation: 0 };
    expect(sectionRadius(el, Math.PI / 2)).toBeCloseTo(1, 6);
    expect(sectionRadius(el, 0)).toBeCloseTo(0.5, 6);
  });

  it('inset ring of a circle is a smaller circle', () => {
    const ring = sectionRing(DEFAULT_PARAMS.base.section, 100, angles(64), 0, 5);
    for (const [x, y] of ring) expect(Math.hypot(x, y)).toBeCloseTo(45, 1);
  });
});

describe('computeLayout', () => {
  it('clearance sizing puts the inner wall exactly the requested distance from the bulb', () => {
    const p = params((p) => {
      p.shade.sizing = 'clearance';
      p.shade.bulbClearance = 70;
    });
    const l = computeLayout(p);
    const c = shadeBulbClearance(l.shade, l.shadeBottom, l.bulbProfile);
    expect(c.distance).toBeCloseTo(70, 0);
    expect(l.shadeBottomSize / l.shadeTopSize).toBeCloseTo(p.shade.bottomSize / p.shade.topSize, 6);
  });

  it('ring-mount socket stack reaches through plate, hub and ring', () => {
    const l = computeLayout(DEFAULT_PARAMS);
    expect(l.socketTop).toBeGreaterThan(l.ringBottom + DEFAULT_PARAMS.hardware.socket.ringThickness);
    expect(l.contactZ).toBeLessThan(l.socketTop);
    expect(l.issues).toEqual([]);
  });

  it('flags a socket skirt too short for the stack', () => {
    const l = computeLayout(params((p) => (p.hardware.socket.skirtLength = 5)));
    expect(l.issues.some((s) => s.includes('skirt'))).toBe(true);
  });
});
