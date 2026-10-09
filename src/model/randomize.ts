import { UL153_OPEN_CLOSED } from './hardware';
import { computeLayout } from './layout';
import { DEFAULT_PARAMS, type LampParams, type RibWave, type SectionParams, type TexturePattern } from './params';
import { angles, sectionRadius } from './section';

/**
 * Seeded random lamp designs. Only the form is randomised (base, stem, cup, shade, legs); the hardware,
 * bulb, materials and quality settings are carried over from the current params because they describe what
 * the user owns and prints with. Dimensions are derived from the hardware so the stack always fits; safety
 * is then screened by `searchDesign` (safety/randomize.ts), which builds and checks every candidate.
 */

export type Rng = () => number;

/** mulberry32: small, fast, good enough for design sampling; same seed → same design. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
const int = (r: Rng, lo: number, hi: number) => Math.floor(range(r, lo, hi + 1));
const chance = (r: Rng, p: number) => r() < p;
const round = (x: number, step = 1) => Math.round(x / step) * step;
function pick<T>(r: Rng, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)];
}

type Archetype = 'stem' | 'fitter' | 'pedestal' | 'tripod';

function randomSection(r: Rng, minSides = 3): SectionParams {
  const roll = r();
  if (roll < 0.4) return { ...DEFAULT_PARAMS.base.section };
  if (roll < 0.8) {
    const sides = int(r, minSides, 8);
    return {
      kind: 'polygon',
      sides,
      cornerRadius: round(range(r, 0.08, 0.45), 0.01),
      exponent: 4,
      aspect: 1,
      rotation: chance(r, 0.5) ? 0 : round(180 / sides, 0.1),
    };
  }
  return { kind: 'superellipse', sides: 6, cornerRadius: 0.2, exponent: round(range(r, 2.5, 5), 0.1), aspect: 1, rotation: 0 };
}

/** Smallest polar radius of a unit section — a section of size S has inradius ≥ S × this. */
function unitInradius(s: SectionParams): number {
  let min = Infinity;
  for (const phi of angles(180)) min = Math.min(min, sectionRadius(s, phi));
  return min;
}

/** Cup sized from the socket hardware so the cavity, nut pocket and plate always fit. */
function fitCup(p: LampParams, section: SectionParams): void {
  const hw = p.hardware;
  const cu = p.cup;
  const hanging = hw.socketMount !== 'nipple'; // ring and snap-in bodies hang inside the cup
  const cavity =
    hw.socketMount === 'snap'
      ? Math.max(hw.socket.bodyDiameter, hw.socket.clipReach) + cu.clearance
      : hw.socketMount === 'ring'
        ? hw.socket.bodyDiameter + cu.clearance
        : hw.nutAcrossFlats / Math.cos(Math.PI / 6) + 4;
  cu.section = section;
  cu.topScale = 1;
  cu.cavityDiameter = 0;
  cu.size = Math.ceil((cavity + 2 * 3) / (2 * unitInradius(section)));
  cu.height = hanging ? Math.ceil(hw.socket.bodyLength + 4) : 36;
  // snap-in clips only grip a thin panel: plate alone (or plate + hub, see the hub mounts) sits mid-range
  if (hw.socketMount === 'snap') cu.plateThickness = round((hw.socket.gripMin + hw.socket.gripMax) / 2, 0.1);
}

function randomTexture(r: Rng, heightMm: number, circumferenceMm: number): LampParams['shade']['texture'] {
  const pattern = pick<TexturePattern>(r, ['knit', 'knurl', 'ribs', 'checker']);
  const cell = range(r, 5, 9);
  return {
    pattern,
    columns: Math.max(24, Math.min(110, round(circumferenceMm / cell))),
    rows: pattern === 'ribs' ? 1 : Math.max(10, Math.min(110, round(heightMm / cell))),
    depth: round(range(r, 0.5, 1.3), 0.05),
    twist: pattern === 'ribs' && chance(r, 0.5) ? round(range(r, -120, 120)) : 0,
  };
}

function randomSurface(r: Rng, p: LampParams): void {
  const s = p.shade;
  const circumference = Math.PI * Math.max(s.bottomSize, s.topSize);
  const roll = r();
  if (roll < 0.15) {
    s.style = 'smooth';
  } else if (roll < 0.45) {
    s.style = 'ribs';
    s.ribCount = int(r, 16, 72);
    s.ribDepth = round(range(r, 1.5, 4.5), 0.1);
    s.ribWave = pick<RibWave>(r, ['sine', 'triangle', 'square', 'scallop']);
    s.ribCorrugated = chance(r, 0.8);
    s.ribTwist = chance(r, 0.3) ? round(range(r, -90, 90)) : 0;
    s.ribFade = chance(r, 0.3) ? round(range(r, 0.05, 0.2), 0.01) : 0;
  } else if (roll < 0.6) {
    s.style = 'perforated';
    s.perfPattern = pick(r, ['circles', 'hexes', 'slots', 'diamonds', 'voronoi'] as const);
    s.perfSize = round(range(r, 6, 13), 0.5);
    s.perfSpacing = round(range(r, 2.5, 5), 0.5);
    s.perfElongation = round(range(r, 1.5, 3.5), 0.1);
    s.perfMargin = round(range(r, 10, 18));
    s.perfSeed = int(r, 0, 9999);
    s.perfStagger = chance(r, 0.7);
    s.wallThickness = Math.max(s.wallThickness, 1.8);
  } else if (roll < 0.85) {
    s.style = 'textured';
    s.texture = randomTexture(r, s.height, circumference);
  } else {
    s.style = 'basket';
    s.basketStrands = 2 * int(r, 6, 12);
    s.basketStrandWidth = round(range(r, 4, 6.5), 0.5);
    s.basketStrandThickness = 1.6;
    s.basketAngle = round(range(r, 35, 55));
    s.basketRim = 8;
  }
}

/**
 * A random design for `current`'s hardware and bulb. The shade is not yet sized for UL 153 spacing — run
 * {@link fitSpacing} (or let `searchDesign` do it) before using it.
 */
export function generateDesign(current: LampParams, seed: number): LampParams {
  const r = rng(seed);
  const p = structuredClone(DEFAULT_PARAMS);
  p.name = `Random ${(seed >>> 0).toString(36)}`;
  p.hardware = structuredClone(current.hardware);
  p.bulb = structuredClone(current.bulb);
  p.materials = structuredClone(current.materials);
  p.quality = structuredClone(current.quality);

  // the cord clamp sits in the underside channel of a solid plinth, and a bottom diffuser hangs under a hub:
  // only the stem / fitter archetypes have those
  const hubOnly = p.hardware.strainRelief.enabled || current.shade.diffuser.position === 'bottom';
  const archetype = pick<Archetype>(r, hubOnly ? ['stem', 'fitter'] : ['stem', 'stem', 'fitter', 'pedestal', 'pedestal', 'tripod']);
  const family = randomSection(r);
  const b = p.base;
  const st = p.stem;
  const s = p.shade;
  const e12 = p.hardware.socketBase === 'E12';
  const k = e12 ? 0.7 : 1; // candelabra lamps are smaller overall

  fitCup(p, chance(r, 0.5) || (family.kind === 'polygon' && family.sides < 5) ? { ...DEFAULT_PARAMS.cup.section } : family);
  b.section = family;
  b.edgeStyle = chance(r, 0.75) ? 'fillet' : 'chamfer';
  b.texture = { ...b.texture, pattern: 'none' };
  s.bottomSection = family;
  s.topSection = chance(r, 0.8) ? { ...family } : randomSection(r);
  s.sizing = 'absolute';
  s.vaseMode = false;
  s.topClosure = 'open';
  s.wallThickness = round(range(r, 1.4, 2), 0.1);
  s.rimThickening = chance(r, 0.5) ? round(range(r, 0.4, 0.8), 0.1) : 0;
  s.twist = family.kind === 'circle' || chance(r, 0.6) ? 0 : round(range(r, -60, 60));
  s.height = round(range(r, 150, 290) * k);

  if (archetype === 'stem' || archetype === 'fitter') {
    s.mount = archetype === 'fitter' ? 'fitter' : 'spider';
    s.bottomSize = round(range(r, 180, 260) * k);
    s.topSize = round(s.bottomSize * range(r, 0.55, 1));
    s.profile = chance(r, 0.6) ? 'linear' : 'bulge';
    s.bulge = round(range(r, -0.08, 0.22), 0.01);
    s.bulgePosition = round(range(r, 0.35, 0.65), 0.01);
    s.mountHeight = round(range(r, 0, 40) * k);
    // a bottom diffuser needs its disc + a few mm of skirt below the hub
    const df = current.shade.diffuser;
    if (df.position === 'bottom') s.mountHeight = Math.max(s.mountHeight, Math.ceil(df.inset + df.thickness + Math.min(df.skirtHeight, 8) + 1));
    s.spokeCount = int(r, 3, 4);
    s.spokeRise = round(range(r, 20, 40));
    const hubHole =
      (p.hardware.socketMount === 'ring'
        ? p.hardware.socket.skirtDiameter
        : p.hardware.socketMount === 'snap'
          ? p.hardware.socket.snapHoleDiameter
          : p.hardware.nippleDiameter) + p.cup.clearance;
    s.hubOuterDiameter = Math.ceil(hubHole + 18);
    if (p.hardware.socketMount === 'snap') {
      const sock = p.hardware.socket;
      p.cup.plateThickness = round(Math.max(1, sock.gripMin), 0.1);
      s.hubThickness = round(Math.max(0.6, (sock.gripMin + sock.gripMax) / 2 - p.cup.plateThickness + 0.4), 0.1);
    }
    b.size = round(s.bottomSize * range(r, 0.6, 0.8));
    b.height = round(range(r, 18, 36) * k);
    b.topScale = round(range(r, 0.8, 1), 0.01);
    b.topEdgeRadius = round(range(r, 2, Math.min(10, b.height / 3)), 0.5);
    b.bottomEdgeRadius = round(range(r, 1, 3), 0.5);
    b.weightPocketDiameter = chance(r, 0.6) ? round(b.size * 0.55) : 0;
    b.weightPocketDepth = round(b.height * 0.6, 0.5);
    b.feetCount = int(r, 3, 4);
    st.height = round(range(r, 60, 220) * k);
    st.section = chance(r, 0.5) ? { ...DEFAULT_PARAMS.stem.section } : { ...family };
    st.size = round(range(r, 18, 30) * k, 0.5);
    st.topScale = round(range(r, 0.8, 1.15), 0.01);
    st.twist = st.section.kind === 'polygon' && chance(r, 0.4) ? round(range(r, -90, 90)) : 0;
  } else {
    // pedestal / tripod: no stem; the shade sleeves over a lip on the base top, flush outside
    st.height = 0;
    st.cupJoint = { ...st.cupJoint, kind: 'spigot', spigotLength: 8 };
    s.mount = 'lip';
    s.baseGrooveDepth = 8;
    s.baseGrooveClearance = 0.4;
    s.rimThickening = 0;
    s.profile = 'linear';
    b.size = round(range(r, 115, 170) * k);
    b.topScale = 1;
    s.bottomSize = b.size;
    s.topSize = round(b.size * range(r, 0.8, 1.1));
    s.topRounding = chance(r, 0.4) ? round(range(r, 0.08, 0.2) * s.topSize) : 0;
    s.rippleCount = chance(r, 0.2) ? int(r, 3, 7) : 0;
    s.rippleDepth = round(range(r, 2, 4), 0.5);
    b.topEdgeRadius = 0;
    b.shellWall = archetype === 'tripod' ? 3 : 2.4;
    b.feetCount = 0;
    if (chance(r, 0.4)) b.texture = randomTexture(r, 60, Math.PI * b.size);
    if (archetype === 'pedestal') {
      b.height = round(range(r, 45, 95) * k);
      b.bottomEdgeRadius = round(range(r, 2, 8), 0.5);
    } else {
      b.height = round(range(r, 26, 36) * k);
      b.bottomEdgeRadius = round(range(r, 4, 12), 0.5);
      b.legs = int(r, 3, 4);
      b.legHeight = round(range(r, 150, 260) * k);
      b.legSpread = round(b.size * range(r, 1.8, 2.3));
      b.legDiameter = round(range(r, 12, 18), 0.5);
      b.legTipDiameter = round(b.legDiameter * range(r, 0.6, 0.9), 0.5);
      b.legRootRadius = round(b.size * 0.2);
      // dowel stock is something the user owns, like the socket: keep their leg type and dowel specs
      b.legKind = current.base.legKind;
      b.dowelDiameter = current.base.dowelDiameter;
      b.dowelClearance = current.base.dowelClearance;
      b.dowelSocketDepth = current.base.dowelSocketDepth;
      b.dowelSleeveWall = current.base.dowelSleeveWall;
      b.dowelMaterial = current.base.dowelMaterial;
      b.cordExitAngle = 90;
    }
  }
  randomSurface(r, p);
  if (s.style === 'basket') s.rippleCount = 0; // ripples fight the over/under weave
  if (p.hardware.wago.enabled) {
    // connector pockets need a solid base, tall enough for the connectors standing, and no weight pocket
    b.shellWall = 0;
    b.weightPocketDiameter = 0;
    b.height = Math.max(b.height, Math.ceil(p.hardware.wago.depth + 2 * p.hardware.wago.clearance + 3));
  }
  if (p.hardware.strainRelief.enabled) {
    b.cordChannel = true;
    // the clamp sits near the edge on the exit line; keep the weight pocket inside it
    b.weightPocketDiameter = Math.min(b.weightPocketDiameter, round(b.size * 0.4));
    b.height = Math.max(b.height, Math.ceil(2.5 * p.hardware.strainRelief.screwDiameter + 12));
  }
  // the diffuser is a material / look choice the user made, like the dowel stock: keep it
  s.diffuser = structuredClone(current.shade.diffuser);
  const plan = computeLayout(p).diffuser;
  if (plan?.position === 'bottom') {
    // a bottom diffuser closes the bottom (Table 47.3): its hole edge must clear the contact by the table spacing,
    // which only lowering the shade (mount height) achieves — the footprint growth in fitLayout cannot
    const row = UL153_OPEN_CLOSED[p.hardware.socketBase].find((rw) => rw.watts >= p.bulb.markedWatts);
    if (row) {
      const l = computeLayout(p);
      const drop = Math.sqrt(Math.max(0, (row.spacing + 3) ** 2 - plan.holeR ** 2));
      s.mountHeight += Math.max(0, Math.ceil(plan.disc1 - (l.contactZ - drop)));
    }
  }

  // the shade must at least reach past the bulb tip
  const layout = computeLayout(p);
  s.height = Math.max(s.height, Math.ceil(layout.bulbTop - layout.shadeBottom + 20));
  return p;
}

/**
 * Scale a design's footprint (shade, and the base/legs it sits on for base-seated mounts) by `f`.
 * Keeps the lip mount flush and the proportions intact.
 */
export function scaleFootprint(p: LampParams, f: number): void {
  const s = p.shade;
  s.bottomSize = round(s.bottomSize * f, 0.5);
  s.topSize = round(s.topSize * f, 0.5);
  s.topRounding = round(s.topRounding * f, 0.5);
  if (s.mount === 'lip' || s.mount === 'base') {
    p.base.size = round(p.base.size * f, 0.5);
    p.base.legSpread = round(p.base.legSpread * f, 0.5);
    if (s.mount === 'lip') s.bottomSize = p.base.size * p.base.topScale;
  }
}

/** Widen the support of a design that tips too easily: spread legs, or a wider weighted plinth. */
export function steady(p: LampParams): void {
  const b = p.base;
  if (b.legs >= 3) {
    b.legSpread = round(b.legSpread * 1.15, 0.5);
    return;
  }
  if (p.shade.mount === 'lip' || p.shade.mount === 'base') {
    scaleFootprint(p, 1.12);
    return;
  }
  b.size = round(b.size * 1.15, 0.5);
  if (b.shellWall <= 0 && !p.hardware.wago.enabled) {
    b.weightPocketDiameter = round(b.size * 0.6);
    b.weightPocketDepth = round(b.height * 0.7, 0.5);
  }
}
