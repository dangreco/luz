import { SOCKET_PRESETS } from '../model/hardware';
import { DEFAULT_PARAMS, type LampParams, type SectionParams } from '../model/params';

export interface Preset {
  id: string;
  name: string;
  description: string;
  params: LampParams;
}

function polygon(sides: number, cornerRadius: number): SectionParams {
  return { kind: 'polygon', sides, cornerRadius, exponent: 4, aspect: 1, rotation: 0 };
}

function derive(name: string, mutate: (p: LampParams) => void): LampParams {
  const p = structuredClone(DEFAULT_PARAMS);
  p.name = name;
  mutate(p);
  return p;
}

const squareTwist = derive('Square twist', (p) => {
  p.base.section = polygon(4, 0.25);
  p.base.size = 140;
  p.stem.section = polygon(4, 0.3);
  p.stem.size = 24;
  p.cup.section = polygon(4, 0.3);
  p.shade.bottomSection = polygon(4, 0.25);
  p.shade.topSection = polygon(4, 0.25);
  p.shade.bottomSize = 220;
  p.shade.topSize = 160;
  p.shade.twist = 45;
  p.shade.style = 'ribs';
  p.shade.ribCount = 32;
  p.shade.ribDepth = 3.5;
  p.shade.ribWave = 'sine';
  p.shade.ribCorrugated = true;
});

const triangleBasket = derive('Triangle basket', (p) => {
  p.base.section = polygon(3, 0.3);
  p.base.size = 170;
  p.base.cordExitAngle = 60;
  p.stem.section = polygon(3, 0.35);
  p.stem.size = 26;
  p.cup.section = polygon(3, 0.35);
  p.cup.size = 56;
  p.shade.bottomSection = polygon(3, 0.3);
  p.shade.topSection = polygon(3, 0.3);
  p.shade.bottomSize = 240;
  p.shade.topSize = 170;
  p.shade.height = 200;
  p.shade.style = 'basket';
  p.shade.basketStrands = 18;
  p.shade.basketStrandWidth = 5;
  p.shade.basketStrandThickness = 1.6;
  p.shade.basketAngle = 45;
  p.shade.basketRim = 8;
});

const perforatedGlobe = derive('Perforated globe', (p) => {
  p.bulb.shape = 'G25';
  p.shade.height = 190;
  p.shade.bottomSize = 140;
  p.shade.topSize = 140;
  p.shade.profile = 'bulge';
  p.shade.bulge = 0.45;
  p.shade.bulgePosition = 0.5;
  p.shade.wallThickness = 2;
  p.shade.style = 'perforated';
  p.shade.perfPattern = 'hexes';
  p.shade.perfSize = 10;
  p.shade.perfSpacing = 3;
  p.shade.perfMargin = 14;
  p.shade.perfStagger = true;
});

const candleE12 = derive('Candle E12', (p) => {
  p.hardware.socketBase = 'E12';
  p.hardware.socket = { ...SOCKET_PRESETS.E12 };
  p.bulb.shape = 'B11';
  p.bulb.watts = 4;
  p.bulb.markedWatts = 25;
  p.base.size = 100;
  p.base.height = 16;
  p.base.topEdgeRadius = 4;
  p.base.feetInset = 10;
  p.base.feetDiameter = 10;
  p.stem.height = 60;
  p.stem.size = 14;
  p.stem.boreDiameter = 10.6;
  p.cup.size = 30;
  p.cup.height = 40;
  p.shade.height = 110;
  p.shade.bottomSize = 120;
  p.shade.topSize = 95;
  p.shade.hubOuterDiameter = 40;
  p.shade.spokeWidth = 4;
  p.shade.ribCount = 36;
  p.shade.ribDepth = 2.5;
});

const vaseCone = derive('Vase-mode cone', (p) => {
  p.base.size = 140;
  p.shade.height = 220;
  p.shade.bottomSize = 210;
  p.shade.topSize = 100;
  p.shade.style = 'smooth';
  p.shade.mount = 'fitter';
  p.shade.vaseMode = true;
  p.shade.vaseLineWidth = 0.8;
  p.shade.rimThickening = 0;
  p.shade.hubOuterDiameter = 70;
});

/** Pedestal lamp: no stem; socket cup stands on the base top, hidden inside a shade that sleeves over a base lip. */
function pedestal(p: LampParams, baseSize: number, baseHeight: number, shadeHeight: number): void {
  p.base.section = { ...DEFAULT_PARAMS.base.section };
  p.base.size = baseSize;
  p.base.height = baseHeight;
  p.base.topScale = 1;
  p.base.topEdgeRadius = 0;
  p.base.bottomEdgeRadius = 4;
  p.base.shellWall = 2.4;
  p.base.feetCount = 0;
  p.base.cordChannel = true;
  p.stem.height = 0;
  p.stem.cupJoint = { ...p.stem.cupJoint, kind: 'spigot', spigotLength: 8 };
  p.cup.size = 50;
  p.cup.height = 64;
  p.shade.mount = 'lip';
  p.shade.baseGrooveDepth = 8;
  p.shade.baseGrooveClearance = 0.4;
  p.shade.sizing = 'absolute';
  p.shade.height = shadeHeight;
  p.shade.bottomSize = baseSize;
  p.shade.topSize = baseSize;
  p.shade.profile = 'linear';
  p.shade.rimThickening = 0;
  p.shade.wallThickness = 1.6;
}

/** Knit cylinder: Ø120 × 280 mm — textured hollow base, rounded-top knit shade sleeved over a lip. */
const knitCylinder = derive('Knit cylinder', (p) => {
  pedestal(p, 120, 70, 210);
  p.base.texture = { pattern: 'checker', columns: 90, rows: 26, depth: 0.5, twist: 0 };
  p.shade.topRounding = 16; // rounded shoulder that still leaves a ≥ 45 cm² top opening (open top)
  p.shade.style = 'textured';
  p.shade.texture = { pattern: 'knit', columns: 72, rows: 84, depth: 1.1, twist: 0 };
});

/** Rippled mesh: Ø120, base 90 mm, 200 mm knurled-mesh shade with soft wandering ripples. */
const rippledMesh = derive('Rippled mesh', (p) => {
  pedestal(p, 120, 90, 200);
  p.base.bottomEdgeRadius = 8;
  p.base.texture = { pattern: 'ribs', columns: 160, rows: 1, depth: 0.35, twist: 0 };
  p.shade.style = 'textured';
  p.shade.texture = { pattern: 'knurl', columns: 96, rows: 110, depth: 0.9, twist: 0 };
  p.shade.rippleCount = 6;
  p.shade.rippleDepth = 3.5;
  p.shade.rippleWobble = 0.25;
});

/**
 * Square linen: tall square linen-textured shade on a small, low square block. The shade
 * hangs from a hidden spider so its bottom edge drops below the cup, close to the block.
 */
const squareLinen = derive('Square linen', (p) => {
  const square = polygon(4, 0.04); // vertices on ±X/±Y → spokes at 0/90/180/270° run into the corners
  p.base.section = { ...square, rotation: 45 };
  p.base.size = 125; // across corners
  p.base.height = 48;
  p.base.topScale = 1;
  p.base.edgeStyle = 'fillet';
  p.base.topEdgeRadius = 3;
  p.base.bottomEdgeRadius = 2;
  p.base.feetCount = 4;
  p.base.feetInset = 16;
  p.base.weightPocketDiameter = 60;
  p.base.weightPocketDepth = 24;
  p.stem.height = 0;
  p.stem.cupJoint = { ...p.stem.cupJoint, kind: 'spigot', spigotLength: 10 };
  p.cup.size = 50;
  p.cup.height = 64;
  p.shade.bottomSection = { ...square, rotation: 45 };
  p.shade.topSection = { ...square, rotation: 45 };
  p.shade.sizing = 'absolute';
  p.shade.bottomSize = 240; // ≈ 170 mm across the flats
  p.shade.topSize = 240;
  p.shade.height = 300;
  p.shade.profile = 'linear';
  p.shade.mount = 'spider';
  p.shade.mountHeight = 52; // shade bottom drops to ~12 mm above the block
  p.shade.spokeCount = 4;
  p.shade.spokeRise = 25;
  p.shade.spokeWidth = 8;
  p.shade.hubOuterDiameter = 60;
  p.shade.wallThickness = 1.6;
  p.shade.rimThickening = 0.6;
  p.shade.style = 'textured';
  p.shade.texture = { pattern: 'checker', columns: 120, rows: 90, depth: 0.35, twist: 0 };
});

/**
 * Tripod dome: capsule shade sitting on a twisted-rope collar, on three splayed legs.
 * The shade sleeves over a lip on the collar; its top is a rounded dome left open at the crown
 * (Ø ≈ 80 mm) so heat escapes — a sealed capsule would trap it (closed/closed is ≤ 7 W only).
 */
const tripodDome = derive('Tripod dome', (p) => {
  p.base.size = 140;
  p.base.height = 30;
  p.base.topScale = 1;
  p.base.topEdgeRadius = 4;
  p.base.bottomEdgeRadius = 12;
  p.base.shellWall = 3;
  p.base.texture = { pattern: 'ribs', columns: 8, rows: 1, depth: 1.6, twist: 110 };
  p.base.legs = 3;
  p.base.legHeight = 230;
  p.base.legSpread = 280;
  p.base.legDiameter = 14;
  p.base.legTipDiameter = 11;
  p.base.legRootRadius = 30;
  p.base.cordExitAngle = 90;
  p.stem.height = 0;
  p.stem.cupJoint = { ...p.stem.cupJoint, kind: 'spigot', spigotLength: 8 };
  p.cup.size = 50;
  p.cup.height = 64;
  p.shade.sizing = 'absolute';
  p.shade.height = 200;
  p.shade.bottomSize = 140;
  p.shade.topSize = 140;
  p.shade.profile = 'linear';
  p.shade.bottomRounding = 0;
  p.shade.topRounding = 28; // dome that still leaves a ≥ 45 cm² crown opening (open top)
  p.shade.topClosure = 'open';
  p.shade.mount = 'lip';
  p.shade.baseGrooveDepth = 8;
  p.shade.baseGrooveClearance = 0.4;
  p.shade.style = 'smooth';
  p.shade.wallThickness = 1.4;
  p.shade.rimThickening = 0;
  p.materials.shade = 'PETG';
});

export const PRESETS: Preset[] = [
  { id: 'knit-cylinder', name: 'Knit cylinder', description: 'Ø120 × 280 mm knit cylinder: textured base, rounded-top knit shade sleeved over a lip.', params: knitCylinder },
  { id: 'rippled-mesh', name: 'Rippled mesh', description: 'Ø120 mm, 90 mm base, 200 mm knurled-mesh shade with wandering ripples.', params: rippledMesh },
  { id: 'square-linen', name: 'Square linen', description: 'Tall square linen-textured shade on a small, low square block.', params: squareLinen },
  { id: 'tripod-dome', name: 'Tripod dome', description: 'Capsule shade with a rounded dome top in a twisted collar on three splayed legs.', params: tripodDome },
  {
    id: 'classic',
    name: 'Classic ribbed',
    description: 'Ribbed conical shade on a stem and round base (defaults).',
    params: structuredClone(DEFAULT_PARAMS),
  },
  { id: 'square-twist', name: 'Square twist', description: 'Rounded-square sections, 45° twist, sine ribs.', params: squareTwist },
  { id: 'triangle-basket', name: 'Triangle basket', description: 'Triangular base with an interlaced basket shade.', params: triangleBasket },
  { id: 'perforated-globe', name: 'Perforated globe', description: 'Bulging shade with hex perforations around a G25 globe bulb.', params: perforatedGlobe },
  { id: 'candle-e12', name: 'Candle E12', description: 'Small candelabra lamp with a B11 bulb.', params: candleE12 },
  { id: 'vase-cone', name: 'Vase-mode cone', description: 'Smooth cone on a separate fitter, exported for spiral-vase printing.', params: vaseCone },
];
