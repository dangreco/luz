import type { ShadeParams } from './params';
import { sectionRadius } from './section';

/**
 * Nominal (style-free) OUTER surface of the shade, in shade-local coordinates:
 * t ∈ [0,1] bottom→top, phi = world angle (radians) about the lamp axis. Surface styles (ribs, texture…)
 * only ever displace OUTWARD from this surface; the inner wall is never closer to the axis than
 * `outerRadius − wall`. Clearance and safety checks rely on that invariant.
 *
 * Profile shaping that is part of the silhouette — taper, bulge/custom profile, rounded shoulders and
 * ripples — lives here (not in the styles), so clearance checks see it.
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

const TAU = Math.PI * 2;

export function shadeSurface(s: ShadeParams, bottomSize: number, topSize: number): ShadeSurface {
  const profile = profileFn(s);
  const size = (t: number) => (bottomSize + (topSize - bottomSize) * Math.pow(t, s.taperCurve)) * profile(t);
  const twist = (t: number) => s.twist * Math.pow(t, s.twistCurve);
  const H = Math.max(1e-6, s.height);
  // Rounded shoulders: radial pull-in following a quarter circle of radius R at each rim.
  const minHalf = Math.min(bottomSize, topSize) / 2;
  const rb = Math.max(0, Math.min(s.bottomRounding, H / 2, minHalf * 0.8));
  const rt = Math.max(0, Math.min(s.topRounding, H / 2, minHalf * 0.8));
  const shoulder = (t: number): number => {
    const z = t * H;
    let d = 0;
    if (rb > 0 && z < rb) d = rb - Math.sqrt(Math.max(0, rb * rb - (rb - z) * (rb - z)));
    if (rt > 0 && H - z < rt) d = Math.max(d, rt - Math.sqrt(Math.max(0, rt * rt - (rt - (H - z)) * (rt - (H - z)))));
    return d;
  };
  // Ripples: soft horizontal bulges whose height wanders around the circumference.
  const rc = Math.max(0, Math.round(s.rippleCount));
  const ripple =
    rc > 0 && s.rippleDepth > 0
      ? (t: number, phi: number): number => {
          const wob = s.rippleWobble * (Math.sin(phi) + 0.5 * Math.sin(2 * phi + 1.3));
          const u = (t + wob / rc) * rc;
          // fade at the rims so the ends stay round and seat cleanly
          const fade = Math.min(1, Math.min(t, 1 - t) * rc * 2);
          return s.rippleDepth * (0.5 - 0.5 * Math.cos(TAU * u)) * fade;
        }
      : null;
  const outerRadius = (t: number, phi: number) => {
    const local = phi - (twist(t) * Math.PI) / 180;
    const unit = (1 - t) * sectionRadius(s.bottomSection, local) + t * sectionRadius(s.topSection, local);
    return size(t) * unit - shoulder(t) + (ripple ? ripple(t, phi) : 0);
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
