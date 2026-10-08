import type { Vec2 } from '../../model/section';
import type { PerfPattern, ShadeParams } from '../../model/params';
import type { ShadeSurface } from '../../model/shadeSurface';
import type { Manifold, ManifoldToplevel } from '../wasm';
import { clamp, clipHalfPlane, mulberry32, polygonArea, radialPrism, TAU } from './common';

/** Angular resolution used to measure row circumferences (independent of export quality). */
const ARC_SEGMENTS = 256;
/** Hard cap on voronoi cells so extreme parameters cannot explode the boolean. */
const MAX_VORONOI_CELLS = 2000;

/**
 * All hole cutters for a perforated shade, unioned into one solid (null when the
 * margins leave no usable room). Holes are laid out on the developed surface
 * (arc length around × height) between z ∈ [zLo, zHi], which the caller has already
 * narrowed by the rim margins and the mount keep-out. Each cutter is a convex
 * radial prism piercing the wall; one union, one subtract.
 */
export function perfCutters(
  m: ManifoldToplevel,
  sh: ShadeParams,
  S: ShadeSurface,
  axisX: number,
  axisY: number,
  shadeBottom: number,
  zLo: number,
  zHi: number,
): Manifold | null {
  const cutters: Manifold[] = [];
  if (sh.perfPattern === 'voronoi') {
    voronoiCutters(m, sh, S, axisX, axisY, shadeBottom, zLo, zHi, cutters);
  } else {
    latticeCutters(m, sh, S, axisX, axisY, shadeBottom, zLo, zHi, cutters);
  }
  if (cutters.length === 0) return null;
  return m.Manifold.union(cutters);
}

/** Regular row/column lattice of shaped holes (circles, hexes, slots, diamonds). */
function latticeCutters(
  m: ManifoldToplevel,
  sh: ShadeParams,
  S: ShadeSurface,
  axisX: number,
  axisY: number,
  shadeBottom: number,
  zLo: number,
  zHi: number,
  out: Manifold[],
): void {
  const size = Math.max(0.5, sh.perfSize);
  const spacing = Math.max(0, sh.perfSpacing);
  const elong = Math.max(1, sh.perfElongation);
  const poly = holePolygon(sh.perfPattern, size, elong);
  let halfV = 0;
  let halfU = 0;
  for (const q of poly) {
    halfV = Math.max(halfV, Math.abs(q[1]));
    halfU = Math.max(halfU, Math.abs(q[0]));
  }
  const vertical = sh.perfPattern === 'slots' || sh.perfPattern === 'diamonds';
  const vPitch = (vertical ? size * elong : size) + spacing;
  const H = S.height;
  const vBot = zLo - shadeBottom;
  const vTop = zHi - shadeBottom;
  let row = 0;
  for (let v = vBot + halfV; v + halfV <= vTop + 1e-9; v += vPitch, row++) {
    const t = clamp(v / H, 0, 1);
    const { L, phiAt, rMean } = rowGeometry(S, t);
    const cols = Math.max(1, Math.floor(L / (size + spacing)));
    const step = L / cols;
    const shift = sh.perfStagger && row % 2 === 1 ? 0.5 : 0;
    for (let c = 0; c < cols; c++) {
      const phi = phiAt(((c + shift) * step) % L);
      const span = wallSpan(S, t, phi, halfU, halfV, rMean, H);
      out.push(radialPrism(m, axisX, axisY, phi, shadeBottom + v, span.rIn, span.rOut, poly));
    }
  }
}

/**
 * Seeded voronoi lattice: jittered-grid sites on the developed (arc, height) domain,
 * periodic around the circumference; each cell is shrunk by perfSpacing/2 and the
 * remaining convex polygon becomes the hole.
 */
function voronoiCutters(
  m: ManifoldToplevel,
  sh: ShadeParams,
  S: ShadeSurface,
  axisX: number,
  axisY: number,
  shadeBottom: number,
  zLo: number,
  zHi: number,
  out: Manifold[],
): void {
  const H = S.height;
  const { L, rMean } = rowGeometry(S, 0.5);
  const vLo = zLo - shadeBottom;
  const vHi = zHi - shadeBottom;
  let pitch = Math.max(2, sh.perfSize + sh.perfSpacing);
  const domain = L * (vHi - vLo);
  if (domain / (pitch * pitch) > MAX_VORONOI_CELLS) pitch = Math.sqrt(domain / MAX_VORONOI_CELLS);
  const cols = Math.max(1, Math.round(L / pitch));
  const rows = Math.max(1, Math.round((vHi - vLo) / pitch));
  const cw = L / cols;
  const ch = (vHi - vLo) / rows;
  const rnd = mulberry32(Math.round(sh.perfSeed));
  const pts: Vec2[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      pts.push([(c + 0.5 + (rnd() - 0.5) * 0.7) * cw, vLo + (r + 0.5 + (rnd() - 0.5) * 0.7) * ch]);
  const reach = (3 * Math.max(cw, ch)) ** 2;
  const shrink = Math.min(sh.perfSpacing / 2, Math.min(cw, ch) / 4);
  const big = 1e6;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let poly: Vec2[] = [
      [-big, vLo - big],
      [big, vLo - big],
      [big, vHi + big],
      [-big, vHi + big],
    ];
    for (let j = 0; j < pts.length && poly.length >= 3; j++) {
      if (j === i) continue;
      let du = pts[j][0] - p[0];
      if (du > L / 2) du -= L;
      else if (du < -L / 2) du += L;
      const dv = pts[j][1] - p[1];
      const d2 = du * du + dv * dv;
      if (d2 > reach || d2 < 1e-12) continue;
      // perpendicular bisector of p→q, keeping the side closer to p
      poly = clipHalfPlane(poly, p[0] + du / 2, p[1] + dv / 2, -du, -dv);
    }
    if (poly.length < 3) continue;
    const shrunk = shrinkPolygon(poly, shrink);
    if (!shrunk || polygonArea(shrunk) < 1.5) continue;
    let cx = 0;
    let cy = 0;
    for (const q of shrunk) {
      cx += q[0];
      cy += q[1];
    }
    cx /= shrunk.length;
    cy /= shrunk.length;
    const local: Vec2[] = shrunk.map((q) => [q[0] - cx, q[1] - cy]);
    let hw = 0;
    let hv = 0;
    for (const q of local) {
      hw = Math.max(hw, Math.abs(q[0]));
      hv = Math.max(hv, Math.abs(q[1]));
    }
    const phi = (((cx / rMean) % TAU) + TAU) % TAU;
    const t = clamp(cy / H, 0, 1);
    const span = wallSpan(S, t, phi, hw, hv, rMean, H);
    out.push(radialPrism(m, axisX, axisY, phi, shadeBottom + cy, span.rIn, span.rOut, local));
  }
}

/** Inward offset of a convex CCW polygon by d (clip by each edge shifted inward). */
function shrinkPolygon(poly: Vec2[], d: number): Vec2[] | null {
  if (d <= 0) return poly;
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    return { ax: a[0], ay: a[1], nx: -ey / len, ny: ex / len };
  });
  let out = poly;
  for (const e of edges) {
    out = clipHalfPlane(out, e.ax + e.nx * d, e.ay + e.ny * d, e.nx, e.ny);
    if (out.length < 3) return null;
  }
  return out;
}

/** Hole shape in the local (u, v) frame, centred on the origin, wound CCW. */
function holePolygon(pattern: PerfPattern, size: number, elong: number): Vec2[] {
  switch (pattern) {
    case 'circles':
      return regularPolygon(size / 2, 12, 0);
    case 'hexes':
      return regularPolygon(size / 2, 6, Math.PI / 6);
    case 'slots':
      return stadium(size, size * elong);
    case 'diamonds':
      return [
        [0, (-size * elong) / 2],
        [size / 2, 0],
        [0, (size * elong) / 2],
        [-size / 2, 0],
      ];
    case 'voronoi':
      return regularPolygon(size / 2, 12, 0);
  }
}

function regularPolygon(r: number, sides: number, rot: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < sides; i++)
    out.push([r * Math.cos(rot + (TAU * i) / sides), r * Math.sin(rot + (TAU * i) / sides)]);
  return out;
}

/** Vertical capsule (rounded-end slot) of width w and total length l. */
function stadium(w: number, l: number): Vec2[] {
  const r = w / 2;
  const half = Math.max(0, (l - w) / 2);
  const cap = 5;
  const out: Vec2[] = [];
  for (let i = 0; i <= cap; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / cap;
    out.push([r * Math.cos(a), half + r * Math.sin(a)]);
  }
  for (let i = 0; i <= cap; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / cap;
    out.push([r * Math.cos(a), -half + r * Math.sin(a)]);
  }
  return out;
}

/**
 * Circumference of the nominal outer ring at height fraction t, plus the mapping from
 * arc length (from phi = 0, CCW) back to world angle.
 */
function rowGeometry(S: ShadeSurface, t: number): { L: number; phiAt: (s: number) => number; rMean: number } {
  const n = ARC_SEGMENTS;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const phi = (TAU * k) / n;
    const r = S.outerRadius(t, phi);
    xs[k] = r * Math.cos(phi);
    ys[k] = r * Math.sin(phi);
  }
  const cum = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    cum[k + 1] = cum[k] + Math.hypot(xs[j] - xs[k], ys[j] - ys[k]);
  }
  const L = cum[n];
  const phiAt = (s: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid + 1] <= s) lo = mid + 1;
      else hi = mid;
    }
    const seg = cum[lo + 1] - cum[lo];
    const f = seg > 1e-12 ? (s - cum[lo]) / seg : 0;
    const j = (lo + 1) % n;
    const x = xs[lo] + (xs[j] - xs[lo]) * f;
    const y = ys[lo] + (ys[j] - ys[lo]) * f;
    const phi = Math.atan2(y, x);
    return phi < 0 ? phi + TAU : phi;
  };
  return { L, phiAt, rMean: L / TAU };
}

/**
 * Radial span a cutter must cover so it fully pierces the wall across the hole's
 * footprint: sampled inner/outer radii over (t ± halfV/H, phi ± halfU/rMean), padded.
 */
function wallSpan(
  S: ShadeSurface,
  t: number,
  phi: number,
  halfU: number,
  halfV: number,
  rMean: number,
  H: number,
): { rIn: number; rOut: number } {
  const dPhi = halfU / Math.max(1e-6, rMean);
  const dT = halfV / Math.max(1e-6, H);
  let rIn = Infinity;
  let rOut = -Infinity;
  for (const dt of [-dT, 0, dT]) {
    const tt = clamp(t + dt, 0, 1);
    for (const dp of [-dPhi, 0, dPhi]) {
      rIn = Math.min(rIn, S.innerRadius(tt, phi + dp));
      rOut = Math.max(rOut, S.outerRadius(tt, phi + dp));
    }
  }
  return { rIn: rIn - 0.7, rOut: rOut + 0.7 };
}
