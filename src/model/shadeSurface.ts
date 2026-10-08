import type { ShadeParams } from './params';
import { sectionRadius } from './section';

/**
 * Nominal (style-free) OUTER surface of the shade, in shade-local coordinates:
 * t ∈ [0,1] bottom→top, phi = world angle (radians) about the lamp axis. Surface styles (ribs, weave…)
 * only ever displace OUTWARD from this surface; the inner wall is never closer to the axis than
 * `outerRadius − wallThickness`. Clearance and safety checks rely on that invariant.
 */
export interface ShadeSurface {
  height: number;
  /** size multiplier at height fraction t (taper + profile), before the section shape */
  size(t: number): number;
  /** twist at t, degrees */
  twist(t: number): number;
  /** nominal outer radius at (t, phi) */
  outerRadius(t: number, phi: number): number;
  /** nominal inner radius (outer − wall, with rim thickening) */
  innerRadius(t: number, phi: number): number;
  /** wall thickness at t (includes rim thickening bands) */
  wall(t: number): number;
}

export function shadeSurface(s: ShadeParams, bottomSize: number, topSize: number): ShadeSurface {
  const profile = profileFn(s);
  const size = (t: number) => (bottomSize + (topSize - bottomSize) * Math.pow(t, s.taperCurve)) * profile(t);
  const twist = (t: number) => s.twist * Math.pow(t, s.twistCurve);
  const outerRadius = (t: number, phi: number) => {
    const local = phi - (twist(t) * Math.PI) / 180;
    const unit = (1 - t) * sectionRadius(s.bottomSection, local) + t * sectionRadius(s.topSection, local);
    return size(t) * unit;
  };
  const wall = (t: number) => {
    const zt = t * s.height;
    const band = Math.max(s.rimBand, 1e-6);
    const nearRim = Math.min(zt, s.height - zt);
    return s.wallThickness + (nearRim < band ? s.rimThickening * (1 - nearRim / band) : 0);
  };
  return {
    height: s.height,
    size,
    twist,
    outerRadius,
    innerRadius: (t, phi) => outerRadius(t, phi) - wall(t),
    wall,
  };
}

function profileFn(s: ShadeParams): (t: number) => number {
  switch (s.profile) {
    case 'linear':
      return () => 1;
    case 'bulge': {
      const p = Math.min(0.9, Math.max(0.1, s.bulgePosition));
      return (t) => {
        const u = t < p ? (0.5 * t) / p : 0.5 + (0.5 * (t - p)) / (1 - p);
        return 1 + s.bulge * Math.sin(Math.PI * u);
      };
    }
    case 'custom': {
      const k = s.customProfile;
      const n = k.length;
      return (t) => {
        const x = Math.min(n - 1, Math.max(0, t * (n - 1)));
        const i = Math.min(n - 2, Math.floor(x));
        const f = x - i;
        const p0 = k[Math.max(0, i - 1)];
        const p1 = k[i];
        const p2 = k[i + 1];
        const p3 = k[Math.min(n - 1, i + 2)];
        // uniform Catmull-Rom
        return (
          0.5 *
          (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
        );
      };
    }
  }
}
