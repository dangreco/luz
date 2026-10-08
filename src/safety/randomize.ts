import { buildLamp } from '../geometry/build';
import type { ManifoldToplevel } from '../geometry/wasm';
import { computeLayout } from '../model/layout';
import type { LampParams } from '../model/params';
import { generateDesign, rng, scaleFootprint, steady } from '../model/randomize';
import { layoutChecks, runChecks } from './checks';

/** Seeds tried before giving up; each costs one or a few coarse builds (~0.2–2 s). */
const MAX_CANDIDATES = 12;
/** Footprint growth steps allowed while chasing UL 153 spacing. */
const MAX_GROW = 10;
/** Support-widening steps allowed while chasing §132 stability. */
const MAX_STEADY = 3;

/**
 * Geometry notes that mean a part won't assemble or lost its intended feature. Benign auto-adjustments
 * (e.g. "spigot engagement limited to …") are not listed.
 */
const BAD_NOTES = [
  'may not fit',
  'may not reach',
  'reaches past',
  'breaks through',
  'skipped',
  'will not pass',
  'Cavity clamped',
];

export interface SearchResult {
  params: LampParams;
  /** seeds tried, including the accepted one */
  tries: number;
  /** titles of warnings left on the accepted design (failures are never accepted) */
  warnings: string[];
}

/** Grow the footprint until no layout-level check (UL 153 spacing, thermal, stack) fails. */
function fitLayout(p: LampParams): boolean {
  for (let i = 0; i <= MAX_GROW; i++) {
    const failing = layoutChecks(p, computeLayout(p)).filter((c) => c.status === 'fail');
    if (failing.length === 0) return true;
    // Only shade size can fix spacing/thermal; socket, designation and stack failures are terminal.
    if (failing.some((c) => c.id !== 'shade-spacing' && c.id !== 'thermal-shade')) return false;
    scaleFootprint(p, 1.08);
  }
  return false;
}

/**
 * Generate random designs for the current hardware until one builds cleanly and passes every safety check
 * (warnings allowed, failures never). Candidates are built at coarse quality for speed; the returned params
 * keep the caller's quality settings.
 */
export function searchDesign(m: ManifoldToplevel, current: LampParams, seed: number): SearchResult {
  const seeds = rng(seed);
  for (let tries = 1; tries <= MAX_CANDIDATES; tries++) {
    const p = generateDesign(current, Math.floor(seeds() * 2 ** 32));
    if (!fitLayout(p)) continue;
    for (let s = 0; s <= MAX_STEADY; s++) {
      const coarse = structuredClone(p);
      coarse.quality = {
        radialSegments: Math.min(96, p.quality.radialSegments),
        ringsPer10mm: Math.min(2, p.quality.ringsPer10mm),
      };
      const build = buildLamp(m, coarse);
      const broken = build.parts.some(
        (part) =>
          part.mesh.indices.length === 0 ||
          part.volume <= 0 ||
          part.notes.some((n) => BAD_NOTES.some((bad) => n.includes(bad))),
      );
      if (broken) break;
      const checks = runChecks(coarse, build);
      const failing = checks.filter((c) => c.status === 'fail');
      if (failing.length === 0)
        return { params: p, tries, warnings: checks.filter((c) => c.status === 'warn').map((c) => c.title) };
      if (failing.some((c) => c.id !== 'stability')) break;
      steady(p);
      if (!fitLayout(p)) break;
    }
  }
  throw new Error(
    `No safe random design found in ${MAX_CANDIDATES} tries for this socket/bulb — check the hardware and bulb settings.`,
  );
}
