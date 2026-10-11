import type { Layout } from '../model/layout';
import type { LampParams } from '../model/params';
import { shadeSurface } from '../model/shadeSurface';
import { bulbCentroid } from '../safety/checks';

/** Number of rays, march step and reach of the light-ray overlay (mm). */
export const BEAM_COUNT = 96;
const STEP = 2;
const MAX_LENGTH = 800;
const BISECT = 14;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface BeamTrace {
  /** bulb luminous centroid the rays start from */
  origin: [number, number, number];
  /** one [x, y, z] per ray: where it ends (shade wall, top cap, base top or table; or MAX_LENGTH out if it escapes) */
  hits: Array<[number, number, number]>;
  /** rays that ended on a surface (the rest escaped through an opening) */
  landed: boolean[];
}

/**
 * Ray-trace `BEAM_COUNT` beams from the bulb centroid over the full sphere (golden-spiral directions) against the
 * shade's nominal inner wall, the top cap (closed / vented tops), the base top (inside its footprint) and the table.
 * The liner and hub do not stop rays: the liner is the transmitter being placed.
 */
export function traceBeams(layout: Omit<Layout, 'shade'>, params: LampParams): BeamTrace {
  const S = shadeSurface(params.shade, layout.shadeBottomSize, layout.shadeTopSize);
  const c = bulbCentroid(layout);
  const { axisX, axisY, shadeBottom, shadeTop, baseTop } = layout;
  const H = Math.max(1e-6, S.height);
  const capZ = shadeTop - params.shade.topThickness;
  const capped = params.shade.topClosure !== 'open';
  const baseR = params.base.size / 2;

  const stops = (x: number, y: number, z: number): boolean => {
    if (z <= 0) return true;
    if (z <= baseTop && Math.hypot(x, y) <= baseR) return true;
    if (capped && z >= capZ) return true;
    const t = (z - shadeBottom) / H;
    if (t < 0 || t > 1) return false;
    return Math.hypot(x - axisX, y - axisY) >= S.innerRadius(t, Math.atan2(y - axisY, x - axisX));
  };

  const hits: Array<[number, number, number]> = [];
  const landed: boolean[] = [];
  for (let i = 0; i < BEAM_COUNT; i++) {
    const dz = 1 - (2 * (i + 0.5)) / BEAM_COUNT;
    const ring = Math.sqrt(Math.max(0, 1 - dz * dz));
    const a = i * GOLDEN_ANGLE;
    const dx = ring * Math.cos(a);
    const dy = ring * Math.sin(a);
    let s = 0;
    let hit = false;
    while (s < MAX_LENGTH) {
      const next = Math.min(MAX_LENGTH, s + STEP);
      if (stops(c.x + dx * next, c.y + dy * next, c.z + dz * next)) {
        // bisect the last step so the ray ends on the surface, not up to a step short of it
        let lo = s;
        let hi = next;
        for (let k = 0; k < BISECT; k++) {
          const mid = (lo + hi) / 2;
          if (stops(c.x + dx * mid, c.y + dy * mid, c.z + dz * mid)) hi = mid;
          else lo = mid;
        }
        s = hi;
        hit = true;
        break;
      }
      s = next;
    }
    hits.push([c.x + dx * s, c.y + dy * s, c.z + dz * s]);
    landed.push(hit);
  }
  return { origin: [c.x, c.y, c.z], hits, landed };
}
