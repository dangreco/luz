import type { PartId } from '../geometry/build';

/** Preview colour per printed part (hex sRGB). Also used for swatches in the parts panel. */
export const PART_COLORS: Record<PartId, number> = {
  base: 0x8f9aa8,
  stem: 0xb9935a,
  cup: 0x6f8fb3,
  shade: 0xe6d5a8,
  fitter: 0xc9785a,
};

/** Bottom → top order of the parts; the exploded view offsets each by its index. */
export const PART_ORDER: PartId[] = ['base', 'stem', 'cup', 'fitter', 'shade'];
