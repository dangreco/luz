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

export const PRESETS: Preset[] = [
  {
    id: 'tela',
    name: 'Tela-style',
    description: 'Ribbed conical shade on a simple round base (defaults).',
    params: structuredClone(DEFAULT_PARAMS),
  },
  { id: 'square-twist', name: 'Square twist', description: 'Rounded-square sections, 45° twist, sine ribs.', params: squareTwist },
  { id: 'triangle-basket', name: 'Triangle basket', description: 'Triangular base with an interlaced basket shade.', params: triangleBasket },
  { id: 'perforated-globe', name: 'Perforated globe', description: 'Bulging shade with hex perforations around a G25 globe bulb.', params: perforatedGlobe },
  { id: 'candle-e12', name: 'Candle E12', description: 'Small candelabra lamp with a B11 bulb.', params: candleE12 },
  { id: 'vase-cone', name: 'Vase-mode cone', description: 'Smooth cone on a separate fitter, exported for spiral-vase printing.', params: vaseCone },
];
