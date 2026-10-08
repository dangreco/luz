import type { BulbTech, DowelMaterial, MaterialId, SocketBase, SocketSpec } from './params';

const IN = 25.4;

/** Socket presets (editable after selection). Sources: Grand Brass SOE26TP81W / SO10038, Nostalgicbulbs BD30-40. */
export const SOCKET_PRESETS: Record<SocketBase, SocketSpec> = {
  E26: {
    bodyDiameter: 39.7,
    bodyLength: 60.3,
    skirtDiameter: 38.1,
    skirtLength: 22,
    ringDiameter: 57,
    ringThickness: 6,
    contactDepth: 24,
    ratedWatts: 75,
  },
  E12: {
    bodyDiameter: 19.1,
    bodyLength: 41.3,
    skirtDiameter: 19.1,
    skirtLength: 14,
    ringDiameter: 30,
    ringThickness: 4,
    contactDepth: 16,
    ratedWatts: 75,
  },
};

export type BulbFamily = 'A' | 'G' | 'B' | 'ST' | 'BR' | 'PAR' | 'CA';

export interface BulbShape {
  id: string;
  label: string;
  base: SocketBase;
  family: BulbFamily;
  /** maximum diameter, mm (ANSI: designation number × 1/8 in) */
  diameter: number;
  /** maximum overall length from the centre contact, mm */
  mol: number;
}

/** ANSI C78 bulb shapes common in Canadian retail. Diameter = designation × 1/8". MOL = typical max. */
export const BULB_SHAPES: BulbShape[] = [
  { id: 'A15', label: 'A15 (small general)', base: 'E26', family: 'A', diameter: 15 * IN / 8, mol: 89 },
  { id: 'A19', label: 'A19 (standard)', base: 'E26', family: 'A', diameter: 19 * IN / 8, mol: 112 },
  { id: 'A21', label: 'A21 (high output)', base: 'E26', family: 'A', diameter: 21 * IN / 8, mol: 135 },
  { id: 'ST19', label: 'ST19 (Edison teardrop)', base: 'E26', family: 'ST', diameter: 19 * IN / 8, mol: 143 },
  { id: 'G25', label: 'G25 (globe 80 mm)', base: 'E26', family: 'G', diameter: 25 * IN / 8, mol: 117 },
  { id: 'G30', label: 'G30 (globe 95 mm)', base: 'E26', family: 'G', diameter: 30 * IN / 8, mol: 135 },
  { id: 'G40', label: 'G40 (globe 125 mm)', base: 'E26', family: 'G', diameter: 40 * IN / 8, mol: 171 },
  { id: 'BR30', label: 'BR30 (flood)', base: 'E26', family: 'BR', diameter: 30 * IN / 8, mol: 127 },
  { id: 'PAR20', label: 'PAR20 (spot)', base: 'E26', family: 'PAR', diameter: 20 * IN / 8, mol: 86 },
  { id: 'B11', label: 'B11 (candle)', base: 'E12', family: 'B', diameter: 11 * IN / 8, mol: 100 },
  { id: 'CA10', label: 'CA10 (flame tip)', base: 'E12', family: 'CA', diameter: 10 * IN / 8, mol: 108 },
  { id: 'G16.5', label: 'G16.5 (small globe)', base: 'E12', family: 'G', diameter: 16.5 * IN / 8, mol: 76 },
  { id: 'A15-E12', label: 'A15 candelabra', base: 'E12', family: 'A', diameter: 15 * IN / 8, mol: 89 },
];

/** Visible screw-shell diameter of the bulb base. */
const BASE_DIAMETER: Record<SocketBase, number> = { E26: 26.5, E12: 12 };
/** Length of the screw shell from the centre contact. */
const BASE_LENGTH: Record<SocketBase, number> = { E26: 24, E12: 17 };

/**
 * Bulb envelope as a piecewise-linear profile: [z from the centre contact, radius] pairs, z ascending,
 * ending at the tip (radius 0). Approximate ANSI outlines — conservative (slightly fat) on purpose.
 */
export function bulbProfile(shape: BulbShape, diameterOverride = 0, lengthOverride = 0): Array<[number, number]> {
  const D = diameterOverride > 0 ? diameterOverride : shape.diameter;
  const L = lengthOverride > 0 ? lengthOverride : shape.mol;
  const R = D / 2;
  const rb = BASE_DIAMETER[shape.base] / 2;
  const lb = Math.min(BASE_LENGTH[shape.base], L * 0.4);
  const pts: Array<[number, number]> = [[0, rb * 0.5], [lb * 0.15, rb], [lb, rb]];
  const body = L - lb;
  const push = (zf: number, rf: number) => pts.push([lb + body * zf, Math.max(rb * Math.min(1, rf * 4), R * rf)]);
  switch (shape.family) {
    case 'G': {
      // neck then a sphere of radius R whose top touches the MOL
      const cz = L - R;
      const zStart = Math.max(lb + 2, cz - Math.sqrt(Math.max(0, R * R - rb * rb)));
      pts.push([zStart, rb]);
      for (let i = 1; i <= 12; i++) {
        const a = -Math.PI / 2 + (i / 12) * Math.PI;
        const z = cz + R * Math.sin(a);
        if (z > zStart) pts.push([z, R * Math.cos(a)]);
      }
      break;
    }
    case 'BR':
    case 'PAR':
      push(0.25, 0.7);
      push(0.6, 0.97);
      push(0.85, 1);
      push(0.97, 0.9);
      push(1, 0.0);
      break;
    case 'B':
    case 'CA':
      push(0.08, 0.75);
      push(0.3, 1);
      push(0.55, 0.95);
      push(0.8, 0.65);
      push(0.95, 0.25);
      push(1, 0);
      break;
    case 'ST':
      push(0.15, 0.55);
      push(0.45, 0.85);
      push(0.7, 1);
      push(0.88, 0.85);
      push(0.97, 0.45);
      push(1, 0);
      break;
    case 'A':
    default:
      push(0.12, 0.55);
      push(0.35, 0.85);
      push(0.6, 1);
      push(0.8, 0.9);
      push(0.93, 0.6);
      push(1, 0);
      break;
  }
  return pts;
}

export interface BulbTechInfo {
  label: string;
  /** fraction of electrical power that becomes heat (rest is visible light) */
  heatFraction: number;
  /** fraction of electrical power radiated as IR from the envelope */
  radiantFraction: number;
  /** typical max envelope temperature, °C (for contact warnings) */
  envelopeTemp: number;
  /** lumens per watt (to convert "equivalent" ratings) */
  efficacy: number;
}

/**
 * Engineering estimates (not test data): LED ~30–40 % wall-plug efficiency, heat is mostly conducted through
 * the heat sink/base and convected; filament LEDs run hotter in the glass; incandescent radiates ~85 % as IR.
 */
export const BULB_TECH: Record<BulbTech, BulbTechInfo> = {
  led: { label: 'LED (standard)', heatFraction: 0.7, radiantFraction: 0.1, envelopeTemp: 60, efficacy: 100 },
  ledFilament: { label: 'LED filament', heatFraction: 0.72, radiantFraction: 0.15, envelopeTemp: 80, efficacy: 110 },
  cfl: { label: 'CFL', heatFraction: 0.8, radiantFraction: 0.2, envelopeTemp: 90, efficacy: 60 },
  incandescent: { label: 'Incandescent', heatFraction: 0.98, radiantFraction: 0.85, envelopeTemp: 200, efficacy: 14 },
  halogen: { label: 'Halogen (E26/E12 retrofit)', heatFraction: 0.97, radiantFraction: 0.8, envelopeTemp: 250, efficacy: 18 },
};

export interface MaterialInfo {
  label: string;
  /** heat deflection temperature, ISO 75 @ 0.45 MPa, °C */
  hdt: number;
  /** g/cm³ */
  density: number;
  source: string;
}

export const MATERIALS: Record<MaterialId, MaterialInfo> = {
  PLA: { label: 'PLA', hdt: 55, density: 1.24, source: 'Prusament PLA TDS v1.1 (ISO 75, 0.45 MPa)' },
  PETG: { label: 'PETG', hdt: 68, density: 1.27, source: 'Prusament PETG TDS v1.1 (ISO 75, 0.45 MPa)' },
  ASA: { label: 'ASA', hdt: 93, density: 1.07, source: 'Prusament ASA TDS v1.1 (ISO 75, 0.45 MPa)' },
  ABS: { label: 'ABS', hdt: 88, density: 1.04, source: 'typical FDM ABS (ISO 75-2 HDT/B 80–93 °C)' },
  PC: { label: 'PC Blend', hdt: 113, density: 1.22, source: 'Prusament PC Blend TDS v1.1 (ISO 75, 0.45 MPa)' },
};

/** Bought dowels / rods for dowel legs: density (g/cm³) for the stability estimate, preview colour. */
export const DOWEL_MATERIALS: Record<DowelMaterial, { label: string; density: number; color: number }> = {
  wood: { label: 'Hardwood dowel (oak/maple ≈ 0.7)', density: 0.7, color: 0xc19a6b },
  aluminum: { label: 'Aluminium rod', density: 2.7, color: 0xb8bec6 },
  steel: { label: 'Steel rod', density: 7.85, color: 0x7d838c },
};

/* ---------------------------------------------------------------------------------------------------------
 * UL 153 (12th ed., 2002) §47 — temperature-test-exempt construction. CSA C22.2 No. 12 is the Canadian
 * counterpart (bi-national portable luminaires). Lampholder "Medium" = E26, "Candelabra" = E12.
 * ------------------------------------------------------------------------------------------------------- */

/** Table 47.1 — min opening area (cm²) for an "open" designation, by max marked wattage. */
export const UL153_OPENING_AREA: Array<{ watts: number; areaCm2: number }> = [
  { watts: 25, areaCm2: 45 },
  { watts: 75, areaCm2: 65 },
  { watts: 100, areaCm2: 84 },
  { watts: 150, areaCm2: 103 },
  { watts: 200, areaCm2: 129 },
  { watts: 250, areaCm2: 155 },
  { watts: 300, areaCm2: 187 },
];

export interface SpacingRow {
  watts: number;
  /** lamp centerline length from the centre contact, mm */
  centerline: number;
  /** minimum lamp-to-shade spacing from any point on the centerline, mm */
  spacing: number;
}

/** Table 47.2 — open top / open bottom. */
export const UL153_OPEN_OPEN: Record<SocketBase, SpacingRow[]> = {
  E26: [
    { watts: 25, centerline: 69.8, spacing: 41.2 },
    { watts: 40, centerline: 82.5, spacing: 50.8 },
    { watts: 60, centerline: 82.5, spacing: 63.5 },
    { watts: 75, centerline: 82.5, spacing: 73 },
    { watts: 100, centerline: 82.5, spacing: 88.9 },
    { watts: 150, centerline: 82.5, spacing: 120.6 },
    { watts: 200, centerline: 98.4, spacing: 152.4 },
    { watts: 250, centerline: 114.3, spacing: 184.4 },
    { watts: 300, centerline: 127, spacing: 215.9 },
  ],
  E12: [
    { watts: 25, centerline: 50.8, spacing: 41.2 },
    { watts: 40, centerline: 50.8, spacing: 50.8 },
    { watts: 60, centerline: 50.8, spacing: 63.5 },
  ],
};

/** Table 47.3 — open top / closed bottom. */
export const UL153_OPEN_CLOSED: Record<SocketBase, SpacingRow[]> = {
  E26: [
    { watts: 25, centerline: 69.8, spacing: 53.9 },
    { watts: 40, centerline: 82.5, spacing: 63.5 },
    { watts: 60, centerline: 82.5, spacing: 76.2 },
    { watts: 75, centerline: 82.5, spacing: 85.7 },
    { watts: 100, centerline: 82.5, spacing: 101.6 },
    { watts: 150, centerline: 82.5, spacing: 133.3 },
    { watts: 200, centerline: 98.4, spacing: 165.1 },
    { watts: 250, centerline: 114.3, spacing: 196.8 },
    { watts: 300, centerline: 127, spacing: 228.6 },
  ],
  E12: [
    { watts: 25, centerline: 50.8, spacing: 53.9 },
    { watts: 40, centerline: 50.8, spacing: 63.5 },
    { watts: 60, centerline: 50.8, spacing: 76.2 },
  ],
};

/** Table 47.4 — closed top / open bottom: (min shade height above the lamp centerline, min spacing) options. */
export const UL153_CLOSED_OPEN: Record<SocketBase, Array<{ watts: number; centerline: number; options: Array<{ height: number; spacing: number }> }>> = {
  E26: [
    { watts: 25, centerline: 69.8, options: [{ height: 63.5, spacing: 76.2 }, { height: 38.1, spacing: 101.6 }] },
    { watts: 40, centerline: 82.5, options: [{ height: 304.8, spacing: 101.6 }, { height: 152.4, spacing: 127 }, { height: 127, spacing: 152.4 }, { height: 88.9, spacing: 177.8 }] },
    { watts: 60, centerline: 82.5, options: [{ height: 330.2, spacing: 127 }, { height: 215.9, spacing: 152.4 }, { height: 139.7, spacing: 177.8 }] },
    { watts: 75, centerline: 82.5, options: [{ height: 279.4, spacing: 152.4 }, { height: 215.9, spacing: 177.8 }, { height: 177.8, spacing: 203.2 }] },
    { watts: 100, centerline: 82.5, options: [{ height: 254, spacing: 177.8 }, { height: 241.3, spacing: 203.2 }, { height: 203.2, spacing: 228.6 }] },
    { watts: 150, centerline: 82.5, options: [{ height: 266.7, spacing: 228.6 }] },
  ],
  E12: [
    { watts: 25, centerline: 50.8, options: [{ height: 171.4, spacing: 50.8 }, { height: 146, spacing: 76.2 }, { height: 120.6, spacing: 101.6 }, { height: 44.4, spacing: 127 }] },
    { watts: 40, centerline: 50.8, options: [{ height: 254, spacing: 101.6 }, { height: 177.8, spacing: 127 }, { height: 139.7, spacing: 152.4 }, { height: 114.3, spacing: 177.8 }] },
    { watts: 60, centerline: 50.8, options: [{ height: 247.6, spacing: 152.4 }] },
  ],
};

/** §47.3.2 / §47.4.3 — closed/closed shades: max 7 W, 25.4 mm from a 50.8 mm centerline. */
export const UL153_CLOSED_CLOSED = { maxWatts: 7, centerline: 50.8, spacing: 25.4 };

/** §132.2.2 — stability incline. */
export const UL153_STABILITY_DEG = 8;

export const UL153_SOURCE = 'UL 153 Portable Electric Luminaires, 12th ed. (2002) §47, §132; counterpart CSA C22.2 No. 12';
