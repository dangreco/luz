/**
 * Every user-tunable parameter of the lamp. Units: millimetres, degrees, watts, °C.
 * Coordinate system: Z up, table surface at z = 0, lamp axis on the Z axis.
 * Ranges in comments are the UI limits; geometry code must tolerate the full range.
 */

export type ShapeKind = 'circle' | 'polygon' | 'superellipse';

/** A closed, star-shaped cross-section. Size (circumscribed diameter along X) is supplied separately. */
export interface SectionParams {
  kind: ShapeKind;
  /** polygon: 3..12 */
  sides: number;
  /** polygon corner rounding, 0 (sharp) .. 1 (fully round = inscribed circle) */
  cornerRadius: number;
  /** superellipse exponent 1.2..8 (2 = ellipse, 4 = squircle) */
  exponent: number;
  /** y-extent / x-extent, 0.3..3 */
  aspect: number;
  /** rotation about Z, -180..180 */
  rotation: number;
}

export type SocketBase = 'E26' | 'E12';
export type SocketMount = 'nipple' | 'ring';
export type BulbTech = 'led' | 'ledFilament' | 'cfl' | 'incandescent' | 'halogen';
export type MaterialId = 'PLA' | 'PETG' | 'ASA' | 'ABS' | 'PC';

export interface SocketSpec {
  /** socket body outer diameter (measure yours) */
  bodyDiameter: number;
  /** socket body length, bottom of cap to top rim */
  bodyLength: number;
  /** threaded skirt (shade-ring thread) outer diameter */
  skirtDiameter: number;
  /** threaded skirt length, measured down from the top rim */
  skirtLength: number;
  /** shade ring outer diameter */
  ringDiameter: number;
  /** shade ring thickness */
  ringThickness: number;
  /** distance from socket top rim down to the bulb centre contact */
  contactDepth: number;
  /** socket wattage rating printed on the socket */
  ratedWatts: number;
}

export interface HardwareParams {
  socketBase: SocketBase;
  /** nipple: keyless socket screwed onto a 1/8 IPS nipple through the cup top.
   *  ring: socket hangs inside the cup, threaded skirt pokes through the cup's top plate, shade ring clamps. */
  socketMount: SocketMount;
  socket: SocketSpec;
  /** 1/8 IPS nipple OD = 10.29 */
  nippleDiameter: number;
  /** hex nut across flats for the nipple (1/8 IPS lamp nut, typically 12.7) */
  nutAcrossFlats: number;
  nutThickness: number;
  /** flat cord (e.g. SPT-2 18 AWG) cross-section */
  cordWidth: number;
  cordThickness: number;
  /** cord set comes with plug attached (plug must pass through the bore) */
  prewiredCord: boolean;
  plugWidth: number;
  plugThickness: number;
}

export interface BulbParams {
  /** key into BULB_SHAPES (hardware.ts); must match socketBase */
  shape: string;
  tech: BulbTech;
  /** actual electrical watts of the bulb in use */
  watts: number;
  /** maximum lamp wattage you will mark on the lamp (drives UL 153 tables) */
  markedWatts: number;
  /** override bulb diameter / MOL; 0 = catalog value */
  diameterOverride: number;
  lengthOverride: number;
}

export type EdgeStyle = 'fillet' | 'chamfer';

/**
 * Outward surface relief shared by the shade, base and cup (see model/texture.ts).
 * knit: brick-staggered rounded bumps; knurl: diamond knurl from two crossing helices (mesh look);
 * ribs: vertical ribs, twisted into rope with `twist`; checker: over/under woven pillows (fine = linen).
 */
export type TexturePattern = 'none' | 'knit' | 'knurl' | 'ribs' | 'checker';

export interface TextureParams {
  pattern: TexturePattern;
  /** cells around the circumference, 2..240 */
  columns: number;
  /** cells along the textured height, 1..300 */
  rows: number;
  /** relief depth, mm (outward only), 0..6 */
  depth: number;
  /** helical twist of the pattern over the textured height, degrees, -720..720 */
  twist: number;
}

export interface BaseParams {
  section: SectionParams;
  /** footprint size (circumscribed diameter) 40..400 */
  size: number;
  height: number;
  /** top size / bottom size, 0.3..1.5 */
  topScale: number;
  /** twist of the base section over its height, -180..180 */
  twist: number;
  edgeStyle: EdgeStyle;
  topEdgeRadius: number;
  bottomEdgeRadius: number;
  texture: TextureParams;
  /** hollow shell wall (0 = solid). Hollow bases are open underneath with a self-supporting 45° roof. */
  shellWall: number;
  /** weight pocket in the bottom (0 diameter = none) */
  weightPocketDiameter: number;
  weightPocketDepth: number;
  /** cord channel on the underside, from centre to the edge (solid plinths only) */
  cordChannel: boolean;
  /** direction the cord exits, degrees */
  cordExitAngle: number;
  /** felt pad recesses on the underside (solid plinths only) */
  feetCount: number;
  feetDiameter: number;
  feetDepth: number;
  /** distance of feet centres from the edge */
  feetInset: number;
  /** splayed legs under the base (0 = solid plinth on the table; 3+ = tripod/legged stand) */
  legs: number;
  /** vertical height of the legs: table → base underside */
  legHeight: number;
  /** diameter of the circle through the leg tips on the table */
  legSpread: number;
  /** leg diameter where it joins the base */
  legDiameter: number;
  /** leg diameter at the (rounded) tip */
  legTipDiameter: number;
  /** radius on the base underside where the leg axes start */
  legRootRadius: number;
}

export interface JointParams {
  /** 'fused' = the two parts are one printed body; 'spigot' = separate parts with a press-fit spigot */
  kind: 'fused' | 'spigot';
  spigotLength: number;
  /** spigot wall around the cord bore */
  spigotWall: number;
  /** diametral clearance between spigot and hole */
  clearance: number;
}

export interface StemParams {
  /** 0 = no stem; the cup sits directly on the base */
  height: number;
  section: SectionParams;
  size: number;
  topScale: number;
  twist: number;
  /** cord bore through the stem */
  boreDiameter: number;
  /** horizontal offset of the stem from the base centre */
  offsetX: number;
  offsetY: number;
  /** joint between base and stem */
  baseJoint: JointParams;
  /** joint between stem and cup */
  cupJoint: JointParams;
}

export interface CupParams {
  section: SectionParams;
  size: number;
  height: number;
  topScale: number;
  /** top plate thickness the socket / nipple bears on */
  plateThickness: number;
  /** cavity under the plate (nut access in nipple mode, socket body in ring mode); 0 = auto */
  cavityDiameter: number;
  /** diametral clearance for holes around hardware */
  clearance: number;
  edgeRadius: number;
}

/**
 * spider: hub + spokes inside the shade, clamped on the socket cup (hidden harp style).
 * fitter: same, as a separate part seated in a groove at the shade bottom.
 * base: shade bottom drops into a groove in a wider base top.
 * lip: shade sleeves over a raised lip on the base top — flush outer surfaces (pedestal lamps).
 */
export type ShadeMount = 'spider' | 'fitter' | 'base' | 'lip';
export type ShadeSizing = 'absolute' | 'clearance';
export type ProfileMode = 'linear' | 'bulge' | 'custom';
export type SurfaceStyle = 'smooth' | 'ribs' | 'perforated' | 'textured' | 'basket';
export type RibWave = 'sine' | 'triangle' | 'square' | 'scallop';
export type PerfPattern = 'circles' | 'hexes' | 'slots' | 'diamonds' | 'voronoi';
export type TopClosure = 'open' | 'closed' | 'vented';

export interface ShadeParams {
  height: number;
  bottomSection: SectionParams;
  topSection: SectionParams;
  /** 'absolute': sizes below are used as-is.
   *  'clearance': both sizes are scaled uniformly so the inner wall's nearest point is
   *  exactly `bulbClearance` from the bulb envelope. */
  sizing: ShadeSizing;
  bottomSize: number;
  topSize: number;
  bulbClearance: number;
  /** how bottom→top size interpolates: exponent on t (1 = straight cone), 0.2..5 */
  taperCurve: number;
  profile: ProfileMode;
  /** bulge: +/- fraction of the local size added at mid-height, -0.5..0.5 */
  bulge: number;
  /** bulge peak position along the height, 0.1..0.9 */
  bulgePosition: number;
  /** custom: 6 size multipliers evenly spaced bottom→top (Catmull-Rom), 0.2..2 */
  customProfile: number[];
  /** twist of the whole shade over its height, -360..360 */
  twist: number;
  /** twist easing exponent (1 = linear) */
  twistCurve: number;
  wallThickness: number;
  /** extra thickness bands at the rims for stiffness */
  rimThickening: number;
  rimBand: number;
  topClosure: TopClosure;
  ventCount: number;
  ventDiameter: number;
  /** thickness of a closed / vented top */
  topThickness: number;

  /** how the shade is supported */
  mount: ShadeMount;
  /** spider / fitter: distance from the shade's bottom edge up to the mount plane (hub bottom) */
  mountHeight: number;
  spokeCount: number;
  spokeWidth: number;
  spokeThickness: number;
  /** spokes rise from hub to wall by this angle (printability), 0..60 */
  spokeRise: number;
  hubOuterDiameter: number;
  hubThickness: number;
  /** fitter: outer rim height and diametral fit clearance against the shade */
  fitterRimHeight: number;
  fitterClearance: number;
  /** base / lip mount: groove depth (base) or lip height (lip), and diametral clearance */
  baseGrooveDepth: number;
  baseGrooveClearance: number;

  style: SurfaceStyle;
  /** ribs / fins / pleats */
  ribCount: number;
  ribDepth: number;
  ribWave: RibWave;
  /** additional twist of the ribs only, degrees over the height */
  ribTwist: number;
  /** corrugated: inner wall follows the ribs (constant thickness, vase-mode friendly); else solid fins */
  ribCorrugated: boolean;
  /** fade the rib depth to zero over this fraction at both rims, 0..0.3 */
  ribFade: number;

  /** perforations */
  perfPattern: PerfPattern;
  /** hole size (diameter / slot width) */
  perfSize: number;
  /** solid web between holes */
  perfSpacing: number;
  /** slot length (slots), diamond aspect (diamonds) */
  perfElongation: number;
  /** keep solid bands at bottom/top */
  perfMargin: number;
  /** voronoi seed */
  perfSeed: number;
  /** stagger alternate rows */
  perfStagger: boolean;

  /** textured style: relief pattern (knit, knurl, ribs/rope, checker/linen) */
  texture: TextureParams;

  /** rounded shoulders: fillet radius at the bottom / top rim of the nominal profile, mm */
  bottomRounding: number;
  topRounding: number;
  /** horizontal ripples: count over the height, outward depth, and vertical wobble amplitude */
  rippleCount: number;
  rippleDepth: number;
  rippleWobble: number;

  /** basket: interlaced helical strands */
  basketStrands: number;
  basketStrandWidth: number;
  basketStrandThickness: number;
  /** helix angle from horizontal, 15..75 */
  basketAngle: number;
  /** solid rim bands at top/bottom of the basket */
  basketRim: number;

  /** export as a solid body for spiral-vase printing (smooth / ribs-corrugated / textured only) */
  vaseMode: boolean;
  /** slicer line width used as the wall thickness in vase mode */
  vaseLineWidth: number;
}

export interface MaterialsParams {
  shade: MaterialId;
  structure: MaterialId;
  /** degrees below the material HDT treated as the service limit */
  heatMargin: number;
  ambient: number;
}

export interface QualityParams {
  /** segments around the circumference */
  radialSegments: number;
  /** rings per 10 mm of shade height */
  ringsPer10mm: number;
}

export interface LampParams {
  version: 1;
  name: string;
  hardware: HardwareParams;
  bulb: BulbParams;
  base: BaseParams;
  stem: StemParams;
  cup: CupParams;
  shade: ShadeParams;
  materials: MaterialsParams;
  quality: QualityParams;
}

const circle: SectionParams = { kind: 'circle', sides: 6, cornerRadius: 0.2, exponent: 4, aspect: 1, rotation: 0 };

export const DEFAULT_PARAMS: LampParams = {
  version: 1,
  name: 'Classic ribbed',
  hardware: {
    socketBase: 'E26',
    socketMount: 'ring',
    socket: {
      bodyDiameter: 39.7,
      bodyLength: 60.3,
      skirtDiameter: 38.1,
      skirtLength: 22,
      ringDiameter: 57,
      ringThickness: 6,
      contactDepth: 24,
      ratedWatts: 75,
    },
    nippleDiameter: 10.29,
    nutAcrossFlats: 12.7,
    nutThickness: 4.8,
    cordWidth: 8.4,
    cordThickness: 4.3,
    prewiredCord: false,
    plugWidth: 22,
    plugThickness: 16,
  },
  bulb: {
    shape: 'A19',
    tech: 'led',
    watts: 9,
    markedWatts: 9,
    diameterOverride: 0,
    lengthOverride: 0,
  },
  base: {
    section: { ...circle },
    size: 150,
    height: 22,
    topScale: 0.92,
    twist: 0,
    edgeStyle: 'fillet',
    topEdgeRadius: 6,
    bottomEdgeRadius: 2,
    texture: { pattern: 'none', columns: 48, rows: 12, depth: 0.8, twist: 0 },
    shellWall: 0,
    weightPocketDiameter: 0,
    weightPocketDepth: 8,
    cordChannel: true,
    cordExitAngle: 180,
    feetCount: 3,
    feetDiameter: 12,
    feetDepth: 1,
    feetInset: 14,
    legs: 0,
    legHeight: 140,
    legSpread: 220,
    legDiameter: 18,
    legTipDiameter: 12,
    legRootRadius: 22,
  },
  stem: {
    height: 120,
    section: { ...circle },
    size: 22,
    topScale: 1,
    twist: 0,
    boreDiameter: 10.6,
    offsetX: 0,
    offsetY: 0,
    baseJoint: { kind: 'spigot', spigotLength: 12, spigotWall: 2.4, clearance: 0.3 },
    cupJoint: { kind: 'spigot', spigotLength: 10, spigotWall: 2.4, clearance: 0.3 },
  },
  cup: {
    section: { ...circle },
    size: 52,
    height: 62,
    topScale: 1,
    plateThickness: 3,
    cavityDiameter: 0,
    clearance: 0.6,
    edgeRadius: 2,
  },
  shade: {
    height: 210,
    bottomSection: { ...circle },
    topSection: { ...circle },
    sizing: 'absolute',
    bottomSize: 230,
    topSize: 150,
    bulbClearance: 60,
    taperCurve: 1,
    profile: 'linear',
    bulge: 0.08,
    bulgePosition: 0.5,
    customProfile: [1, 1, 1, 1, 1, 1],
    twist: 0,
    twistCurve: 1,
    wallThickness: 1.6,
    rimThickening: 0.8,
    rimBand: 6,
    topClosure: 'open',
    ventCount: 6,
    ventDiameter: 18,
    topThickness: 1.6,
    mount: 'spider',
    mountHeight: 0,
    spokeCount: 3,
    spokeWidth: 6,
    spokeThickness: 3,
    spokeRise: 30,
    hubOuterDiameter: 64,
    hubThickness: 3,
    fitterRimHeight: 8,
    fitterClearance: 0.4,
    baseGrooveDepth: 4,
    baseGrooveClearance: 0.5,
    style: 'ribs',
    ribCount: 48,
    ribDepth: 4,
    ribWave: 'triangle',
    ribTwist: 0,
    ribCorrugated: true,
    ribFade: 0,
    perfPattern: 'hexes',
    perfSize: 10,
    perfSpacing: 3,
    perfElongation: 3,
    perfMargin: 12,
    perfSeed: 7,
    perfStagger: true,
    texture: { pattern: 'knit', columns: 64, rows: 70, depth: 1.2, twist: 0 },
    bottomRounding: 0,
    topRounding: 0,
    rippleCount: 0,
    rippleDepth: 4,
    rippleWobble: 0.15,
    basketStrands: 16,
    basketStrandWidth: 5,
    basketStrandThickness: 1.6,
    basketAngle: 45,
    basketRim: 8,
    vaseMode: false,
    vaseLineWidth: 0.8,
  },
  materials: { shade: 'PETG', structure: 'PETG', heatMargin: 10, ambient: 25 },
  quality: { radialSegments: 192, ringsPer10mm: 4 },
};
