import {
  UL153_CLOSED_OPEN,
  UL153_OPEN_OPEN,
  type SpacingRow,
} from '../model/hardware';
import type { Layout } from '../model/layout';
import type { LampParams } from '../model/params';

/** UL 153 §47 lamp centerline and the minimum spacing radius the shade must keep from it. */
export interface UlEnvelope {
  /** centerline length from the bulb centre contact along +Z, mm */
  centerline: number;
  /** required minimum distance from any centerline point to the shade, mm */
  spacing: number;
  /** wattage row of the table that was used */
  watts: number;
  /** human-readable table used */
  table: string;
}

/** Smallest table row that covers `watts`; above the table's top row the top row is used. */
function rowFor<T extends { watts: number }>(rows: T[], watts: number): T {
  return rows.find((r) => r.watts >= watts) ?? rows[rows.length - 1];
}

/**
 * The preview computes the envelope itself (the safety checks expose no geometry). The shade's opening
 * designation is not known here, so open top / open bottom (Table 47.2) is assumed — except for a shade with
 * a closed top, where Table 47.4 (closed top / open bottom) is used with the option whose required height
 * above the centerline is met by the shade (else the widest spacing option).
 */
export function ulEnvelope(p: LampParams, layout: Pick<Layout, 'contactZ' | 'shadeTop'>): UlEnvelope {
  const base = p.hardware.socketBase;
  const watts = p.bulb.markedWatts;

  if (p.shade.topClosure === 'closed') {
    const row = rowFor(UL153_CLOSED_OPEN[base], watts);
    const heightAbove = layout.shadeTop - (layout.contactZ + row.centerline);
    const met = row.options.filter((o) => o.height <= heightAbove);
    const option = met.length > 0
      ? met.reduce((a, b) => (b.spacing < a.spacing ? b : a))
      : row.options.reduce((a, b) => (b.spacing > a.spacing ? b : a));
    return { centerline: row.centerline, spacing: option.spacing, watts: row.watts, table: 'Table 47.4 (closed top / open bottom)' };
  }

  const row: SpacingRow = rowFor(UL153_OPEN_OPEN[base], watts);
  return { centerline: row.centerline, spacing: row.spacing, watts: row.watts, table: 'Table 47.2 (open top / open bottom)' };
}
