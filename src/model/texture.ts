import type { TextureParams } from './params';

const TAU = Math.PI * 2;

/**
 * Outward relief d(u, v) ∈ [0, depth] for a surface parameterised by angle `phi` (radians, around the
 * axis) and height fraction `v` ∈ [0,1] over the textured band. Zero for pattern 'none'. Shared by the
 * shade, base and cup so a texture looks identical on every part.
 *
 * knit:    brick-staggered rounded bumps (each row offset half a cell) — a knitted look.
 * knurl:   diamond knurl from two crossing helices — a mesh look.
 * ribs:    vertical rounded ribs; with `twist` they become rope.
 * checker: over/under pillows — coarse basket weave or, small and shallow, linen.
 */
export function textureField(t: TextureParams): (phi: number, v: number) => number {
  const depth = Math.max(0, t.depth);
  if (t.pattern === 'none' || depth <= 0) return () => 0;
  const cols = Math.max(2, Math.round(t.columns));
  const rows = Math.max(1, Math.round(t.rows));
  const tw = (t.twist * Math.PI) / 180;
  const bump = (f: number): number => 0.5 - 0.5 * Math.cos(TAU * f);
  switch (t.pattern) {
    case 'knit':
      return (phi, v) => {
        const b = v * rows;
        const row = Math.floor(b);
        const a = ((phi - tw * v) / TAU) * cols + (row % 2 === 0 ? 0 : 0.5);
        // rounded stitch: a smooth dome per cell
        return depth * Math.sqrt(bump(a - Math.floor(a)) * bump(b - row));
      };
    case 'knurl':
      return (phi, v) => {
        const a = ((phi - tw * v) / TAU) * cols;
        const b = v * rows;
        // two helix families crossing: peaks where both are high (diamond pyramids)
        const p = bump(a + b);
        const q = bump(a - b);
        return depth * Math.min(p, q);
      };
    case 'ribs':
      return (phi, v) => {
        const a = ((phi - tw * v) / TAU) * cols;
        return depth * bump(a);
      };
    case 'checker':
      return (phi, v) => {
        const a = ((phi - tw * v) / TAU) * cols;
        const b = v * rows;
        const ca = Math.floor(a);
        const cb = Math.floor(b);
        const fa = a - ca;
        const fb = b - cb;
        // over/under: alternate the long axis of each pillow, like threads crossing
        return (((ca + cb) % 2) + 2) % 2 === 0
          ? depth * bump(fb) * (0.6 + 0.4 * bump(fa))
          : depth * bump(fa) * (0.6 + 0.4 * bump(fb));
      };
  }
}

/**
 * Samples needed around / along a textured band: 4 vertices per cell keeps each bump rounded while
 * holding a dense shade (≈100 × 100 cells) to a few hundred thousand triangles.
 */
export function textureSampling(t: TextureParams, per = 4): { around: number; along: number } {
  if (t.pattern === 'none' || t.depth <= 0) return { around: 0, along: 0 };
  const cols = Math.max(2, Math.round(t.columns));
  const rows = Math.max(1, Math.round(t.rows));
  return { around: Math.ceil(cols * per), along: t.pattern === 'ribs' ? 2 : Math.ceil(rows * per) + 1 };
}
