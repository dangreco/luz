import type { ShadeParams } from '../../model/params';
import type { ShadeSurface } from '../../model/shadeSurface';
import { loftSolid } from '../mesh';
import type { Vec3 } from '../mesh';
import type { Manifold, ManifoldToplevel } from '../wasm';
import { clamp, TAU } from './common';

/** Print clearance kept between the over and under strand faces at crossings. */
const WEAVE_GAP = 0.15;

export interface BasketWeave {
  strands: Manifold[];
  /** Radial material outside the nominal inner wall (strand stack-up + skin), for rim bands. */
  bulge: number;
}

/**
 * True interlaced weave: two families of `basketStrands` counter-rotating helices at
 * `basketAngle`. At every crossing the strand centre radius oscillates by ±(thickness/2 + gap)
 * with a sign chosen so the two strands are always on opposite sides (checkerboard for an
 * even strand count; odd counts get one same-phase seam row). Strands ride with their inner
 * face on the nominal inner wall, so bulb clearance is preserved.
 */
export function buildBasketStrands(
  m: ManifoldToplevel,
  sh: ShadeParams,
  S: ShadeSurface,
  axisX: number,
  axisY: number,
  shadeBottom: number,
  zLo: number,
  zHi: number,
): BasketWeave {
  const N = Math.max(2, Math.round(sh.basketStrands));
  const T = Math.max(0.8, sh.basketStrandThickness);
  const W = Math.max(1.2, sh.basketStrandWidth);
  const gap = Math.min(WEAVE_GAP, Math.max(0.1, T * 0.1));
  const amp = T / 2 + gap;
  const alpha = clamp(sh.basketAngle, 10, 80) * (Math.PI / 180);
  const H = S.height;

  // Mean inner radius over the strand band sets the helix pitch (constant in z).
  const NT = 13;
  const NP = 17;
  let meanIn = 0;
  for (let i = 0; i < NT; i++)
    for (let k = 0; k < NP; k++) {
      const z = zLo + ((zHi - zLo) * i) / (NT - 1);
      meanIn += S.innerRadius(clamp((z - shadeBottom) / H, 0, 1), (TAU * k) / NP);
    }
  meanIn /= NT * NP;
  const pitch = TAU * meanIn * Math.tan(alpha);
  // Successive crossings along one strand are evenly spaced by delta in z.
  const delta = Math.max(0.5, pitch / (2 * N));
  const qLo = Math.floor((zLo - 1) / delta) - 2;
  const qHi = Math.ceil((zHi + 1) / delta) + 2;
  const mod = (x: number, n: number): number => ((x % n) + n) % n;

  // Over/under sign of strand `idx` at its crossing z = delta·q. Family +1 meets B strand
  // k = mod(q + idx, N) there; family −1 meets A strand j = mod(idx − q, N). The strand of
  // family +1 is on top when the pair index sum is even, family −1 when it is odd.
  const signs = (idx: number, family: 1 | -1): Int8Array => {
    const arr = new Int8Array(qHi - qLo + 1);
    for (let qi = 0; qi < arr.length; qi++) {
      const q = qLo + qi;
      const other = family === 1 ? mod(q + idx, N) : mod(idx - q, N);
      const even = (idx + other) % 2 === 0;
      arr[qi] = (family === 1 ? even : !even) ? 1 : -1;
    }
    return arr;
  };
  const oscAt = (sg: Int8Array, z: number): number => {
    const x = z / delta;
    const q = Math.floor(x);
    const f = clamp(x - q, 0, 1);
    const qi = clamp(q - qLo, 0, sg.length - 2);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * f);
    return sg[qi] + (sg[qi + 1] - sg[qi]) * e;
  };

  const dz = clamp(delta / 5, 0.35, 3);
  const nz = Math.max(2, Math.ceil((zHi - zLo) / dz) + 1);
  const strands: Manifold[] = [];
  for (const family of [1, -1] as const) {
    for (let idx = 0; idx < N; idx++) {
      const sg = signs(idx, family);
      const phi0 = (TAU * idx) / N;
      const rings: Vec3[][] = [];
      for (let i = 0; i < nz; i++) {
        const z = zLo + ((zHi - zLo) * i) / (nz - 1);
        const t = clamp((z - shadeBottom) / H, 0, 1);
        const phi = phi0 + (family * TAU * (z - shadeBottom)) / pitch;
        const osc = amp * oscAt(sg, z);
        const rc0 = S.innerRadius(t, phi) + T + gap;
        // Ribbon cross-section: width along the circumference (arc), thickness radial,
        // evaluated per corner so non-circular sections and taper can never dip inside.
        const corners: Vec3[] = [];
        for (const [a, b] of [
          [1, 1],
          [1, -1],
          [-1, -1],
          [-1, 1],
        ] as const) {
          const phic = phi + (a * W) / 2 / Math.max(1, rc0);
          const r = S.innerRadius(t, phic) + T + gap + osc + (b * T) / 2;
          corners.push([axisX + r * Math.cos(phic), axisY + r * Math.sin(phic), z]);
        }
        // loftSolid wants rings CCW seen from +Z
        let area2 = 0;
        for (let c = 0; c < 4; c++) {
          const u1 = corners[c];
          const u2 = corners[(c + 1) % 4];
          area2 += u1[0] * u2[1] - u2[0] * u1[1];
        }
        if (area2 < 0) corners.reverse();
        rings.push(corners);
      }
      strands.push(loftSolid(m, rings));
    }
  }
  return { strands, bulge: 2 * T + 2 * gap + 0.3 };
}
