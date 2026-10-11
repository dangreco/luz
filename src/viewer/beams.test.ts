import { describe, expect, it } from 'vitest';
import { computeLayout } from '../model/layout';
import { DEFAULT_PARAMS } from '../model/params';
import { shadeSurface } from '../model/shadeSurface';
import { BEAM_COUNT, traceBeams } from './beams';

describe('light-ray trace', () => {
  const lamp = () => {
    const p = structuredClone(DEFAULT_PARAMS);
    p.shade.topClosure = 'open';
    return p;
  };

  it('ends every side ray on the shade inner wall and lets upward rays escape the open top', () => {
    const p = lamp();
    const layout = computeLayout(p);
    const S = shadeSurface(p.shade, layout.shadeBottomSize, layout.shadeTopSize);
    const trace = traceBeams(layout, p);
    expect(trace.hits).toHaveLength(BEAM_COUNT);

    let onWall = 0;
    let escaped = 0;
    trace.hits.forEach(([x, y, z], i) => {
      const t = (z - layout.shadeBottom) / S.height;
      if (!trace.landed[i]) {
        escaped++;
        // only rays leaving through the open top (or the open bottom) go unstopped
        expect(z > layout.shadeTop || z < layout.shadeBottom).toBe(true);
        return;
      }
      if (t >= 0 && t <= 1) {
        const r = Math.hypot(x - layout.axisX, y - layout.axisY);
        const wall = S.innerRadius(t, Math.atan2(y - layout.axisY, x - layout.axisX));
        expect(Math.abs(r - wall)).toBeLessThan(0.05);
        onWall++;
      }
    });
    expect(onWall).toBeGreaterThan(BEAM_COUNT * 0.4);
    expect(escaped).toBeGreaterThan(0);
  });

  it('ends rays on the cap when the top is closed, and moves hits when the shade rises over the bulb', () => {
    const p = lamp();
    p.shade.topClosure = 'closed';
    const layout = computeLayout(p);
    const closed = traceBeams(layout, p);
    const capZ = layout.shadeTop - p.shade.topThickness;
    const up = closed.hits.filter(([, , z]) => z > layout.bulbTop);
    expect(up.length).toBeGreaterThan(0);
    expect(up.every(([, , z]) => z <= capZ + 0.05)).toBe(true);

    // lowering the shade over a fixed bulb moves where the rays land on the wall (mount height shifts the shade)
    const lowered = lamp();
    lowered.shade.mountHeight = 60;
    const l2 = computeLayout(lowered);
    const a = traceBeams(computeLayout(lamp()), lamp()).hits.map(([, , z]) => z);
    const b = traceBeams(l2, lowered).hits.map(([, , z]) => z);
    expect(a.some((z, i) => Math.abs(z - b[i]) > 1)).toBe(true);
  });
});
