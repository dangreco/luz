import { BULB_SHAPES, bulbProfile, type BulbShape } from './hardware';
import type { HardwareParams, LampParams } from './params';
import { angles, sectionRadius } from './section';
import { shadeSurface, type ShadeSurface } from './shadeSurface';

/**
 * Resolved vertical stack and derived dimensions — the single source of truth shared by geometry,
 * safety checks and the preview. World frame: Z up, table at z = 0, lamp axis through (axisX, axisY).
 *
 *   legs     z ∈ [0, baseBottom]               base.legs ≥ 3 only: splayed legs lift the base
 *   base     z ∈ [baseBottom, baseTop]         centred on the origin
 *   stem     z ∈ [baseTop, stemTop]            centred on (axisX, axisY)
 *   cup      z ∈ [stemTop, cupTop]             top plate occupies [cupTop − plateThickness, cupTop]
 *   hub      z ∈ [cupTop, cupTop + hubThk]     spider/fitter only: shade hub clamped on the cup top
 *   socket   ring mode: body below the plate, threaded skirt up through plate (+hub), shade ring on top
 *            nipple mode: socket cap sits on the plate (or hub), body above
 *            snap mode: face flange on the plate (or hub), body below; clip wings grip plate (+hub) from beneath
 *   contact  bulb centre contact; bulb grows upward along +Z from here
 *   shade    z ∈ [shadeBottom, shadeBottom + shade.height]
 */
export interface LegAxis {
  /** upper end of the leg axis, inside the base just under its top skin */
  top: [number, number, number];
  /** lower end: centre of the printed foot sphere, or the dowel axis on the table (z = 0) */
  tip: [number, number, number];
}

/** Diametral slack added around the cord wherever it passes through material. */
export const CORD_CLEAR = 0.8;

/** Diameter a bore must have so the cord — or the moulded plug, when the cord set is prewired — passes. */
export function cordBoreDiameter(hw: HardwareParams): number {
  if (!hw.prewiredCord) return Math.max(hw.cordWidth, hw.cordThickness) + 2 * CORD_CLEAR;
  return Math.hypot(hw.plugWidth, hw.plugThickness) + 2 * CORD_CLEAR;
}

const DEG = Math.PI / 180;

/** Min screw engagement in the printed base (self-tapping into plastic: ≥ 2–2.5 × the screw diameter). */
const SCREW_ENGAGE = 2.5;
/** Insert-mode screws are always M3 (the Voron M3×5×4 insert). */
export const INSERT_SCREW = 3;
/** Min printed wall around a heat-set insert (CNC Kitchen W for M3×5×4). */
export const INSERT_WALL = 1.6;
/** ISO 4762 / 7380 M3 stock lengths, mm. */
const M3_LENGTHS = [4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40];

/** A blind screw hole opening downward (mouth at the bottom, depth upward). */
export interface FastenerHole {
  kind: 'insert' | 'selfTap';
  /** nominal screw diameter */
  screw: number;
  /** modeled bore: insert hole or 0.8·d pilot */
  diameter: number;
  /** blind depth above the mouth */
  depth: number;
  /** 45° lead-in at the mouth (0 = none) */
  chamfer: number;
  /** radius around the hole centre that must stay printed material */
  wallRadius: number;
  /** boss diameter when the hole needs a standalone boss */
  bossDiameter: number;
}

export function fastenerHole(hw: HardwareParams, selfTapScrew: number): FastenerHole {
  if (hw.fastening === 'insert') {
    const ins = hw.insert;
    const wallRadius = ins.outerDiameter / 2 + INSERT_WALL;
    return {
      kind: 'insert',
      screw: INSERT_SCREW,
      diameter: ins.holeDiameter,
      depth: ins.length + 1,
      chamfer: Math.max(0, ins.chamfer),
      wallRadius,
      bossDiameter: 2 * wallRadius,
    };
  }
  const d = Math.max(1.5, selfTapScrew);
  return {
    kind: 'selfTap',
    screw: d,
    diameter: 0.8 * d,
    depth: SCREW_ENGAGE * d + 1,
    chamfer: 0,
    wallRadius: d / 2 + 2,
    bossDiameter: SCREW_ENGAGE * d + 3,
  };
}

/** Screw length for clamping `grip` mm of part onto `hole`. */
export function screwLength(hole: FastenerHole, grip: number, insertLength: number): number {
  if (hole.kind === 'selfTap') return Math.ceil(grip + hole.depth - 1);
  // ≥ 2.5 mm thread in the insert, never bottoming in the L + 1 blind hole
  const max = grip + insertLength + 0.8;
  const fit = M3_LENGTHS.filter((l) => l >= grip + 2.5 && l <= max);
  return fit.length ? fit[fit.length - 1] : Math.floor(max);
}

/** Printed wall around a connector sleeve, and the end stop behind its centre end. */
export const SLEEVE_WALL = 2;
export const SLEEVE_STOP = 2;

/** Distance from the lamp axis to the base outline along `along`, shrunk by `inset`; Infinity if never reached. */
function baseEdgeAlong(b: LampParams['base'], axisX: number, axisY: number, along: [number, number], inset: number): number {
  for (let s = 0; s < 400; s += 0.5) {
    const x = axisX + along[0] * s;
    const y = axisY + along[1] * s;
    if (Math.hypot(x, y) > sectionRadius(b.section, Math.atan2(y, x)) * b.size - inset) return s;
  }
  return Infinity;
}

/** Tray floor thickness of the split wiring-bay base. */
export const BAY_FLOOR = 3;

/** Deck thickness of the split wiring-bay base: the top slab carrying the shade seat and the cup hole. */
export function bayDeckThickness(b: LampParams['base']): number {
  return Math.max(4, b.topEdgeRadius > 0 ? b.topEdgeRadius + 2 : 0);
}

/** Lowest base height that holds the tray floor, the connector sleeves and the deck. */
export function minBayBaseHeight(p: LampParams): number {
  const w = p.hardware.wago;
  return w.height + 2 * Math.max(0, w.clearance) + bayDeckThickness(p.base) + BAY_FLOOR + 0.5;
}

/**
 * Split service base: a bottom **tray** (floor + outer wall, z up to `depth`) holding the splice connectors in sleeves
 * standing on its floor, and a top **deck** (the slab above `depth`) carrying the shade seat. Four M3 screws from below
 * pass through the tray floor into heat-set inserts in the socket cup's spigot and clamp tray, deck and cup together.
 * Positions are world XY; `along` is the unit cord-exit direction.
 */
export interface WiringBay {
  /** bay cavity, round, centred on the lamp axis */
  diameter: number;
  /** base underside up to the deck underside (the tray / deck split plane) */
  depth: number;
  /** tray floor thickness */
  floor: number;
  /** deck slab thickness */
  deckThickness: number;
  /** world z of the cup insert mouths = the cup spigot end face */
  cupScrewMouthZ: number;
  /** outer radius of the (enlarged) cup spigot */
  spigotRadius: number;
  /** two connector sleeves standing on the floor; (x, y) = centre of the inner slot, which slides along `along`
   *  and is open at its outer end and upward; `len` / `wid` / `hgt` = inner slot length / width / height */
  sleeves: Array<{ x: number; y: number; along: [number, number]; len: number; wid: number; hgt: number }>;
  /** the 4 cup-screw positions */
  screws: Array<{ x: number; y: number }>;
  /** cup-screw holes in the spigot end face (mouth at `cupScrewMouthZ`, opening downward) */
  hole: FastenerHole;
  /** cord exit: a width × height box through the tray wall along `along`, hugging the deck underside; (x, y) = its centre,
   *  z = centre height, len = length along the exit direction */
  exit: { x: number; y: number; z: number; along: [number, number]; width: number; height: number; len: number };
}

function wiringBay(
  p: LampParams,
  baseBottom: number,
  axisX: number,
  axisY: number,
  issues: string[],
): WiringBay | null {
  const hw = p.hardware;
  const w = hw.wago;
  const b = p.base;
  const st = p.stem;
  if (!w.enabled) return null;
  if (b.shellWall > 0) {
    issues.push('The wiring bay needs a solid base — set the hollow shell wall to 0 or disable the wiring bay.');
    return null;
  }
  if (st.height > 0 || st.cupJoint.kind === 'fused') {
    issues.push(
      'The split wiring-bay base needs the socket cup seated directly on it — set the stem height to 0 with a spigot cup joint, or disable the wiring bay.',
    );
    return null;
  }
  const legged = b.legs >= 3;
  if (!legged && b.weightPocketDiameter > 0)
    issues.push('The weight pocket sits inside the wiring bay — disable one of them.');

  const hole = fastenerHole(hw, INSERT_SCREW);
  const deckT = bayDeckThickness(b);
  const c = Math.max(0, w.clearance);
  const hgt = w.height + 2 * c;
  const wid = w.width + 2 * c;
  const len = w.depth + 2 * c + 1;
  const depth = b.height - deckT;
  if (depth < BAY_FLOOR + hgt + 0.5) {
    issues.push(
      `Base too low for the wiring bay (needs ≥ ${minBayBaseHeight(p).toFixed(1)} mm) — raise the base or disable the bay.`,
    );
    return null;
  }

  // cavity diameter: as wide as the narrowest underside / top outline allows, 3 mm of wall all round
  let inradius = Infinity;
  for (const phi of angles(72)) {
    const rb = sectionRadius(b.section, phi) * b.size;
    const rt = sectionRadius(b.section, phi - b.twist * DEG) * b.size * b.topScale;
    inradius = Math.min(inradius, Math.min(rb, rt) - b.bottomEdgeRadius);
  }
  const axisOff = Math.hypot(axisX, axisY);
  let diameter = 2 * (inradius - axisOff - 3);
  if (legged) {
    // the legs are unioned after the cavity cut: keep the bay clear of their roots
    const rTop = b.legKind === 'dowel' ? (b.dowelDiameter + b.dowelClearance) / 2 + b.dowelSleeveWall : b.legDiameter / 2;
    diameter = Math.min(diameter, 2 * (b.legRootRadius - rTop - 3 - axisOff));
  }

  // sleeves: two channels either side of the exit line, slot centred on the axis along the exit direction
  const exitA = b.cordExitAngle * DEG;
  const along: [number, number] = [Math.cos(exitA), Math.sin(exitA)];
  const across: [number, number] = [-along[1], along[0]];
  const cordD = cordBoreDiameter(hw);
  // The cup spigot (enlarged to carry the 4 base-screw inserts) stands between the sleeves; clear it by ≥ 1 mm.
  const rSpigot = Math.max(
    cordD / 2 + Math.max(1.2, st.cupJoint.spigotWall),
    cordD / 2 + 2 + hw.insert.outerDiameter + INSERT_WALL,
  );
  const off = wid / 2 + SLEEVE_WALL + Math.max(cordD / 2 + 1, rSpigot + 1);
  const spigotLen = Math.min(Math.max(2, b.height - 2.5), Math.max(2, st.cupJoint.spigotLength));
  const sleeveR = Math.hypot(len / 2 + SLEEVE_STOP, off + wid / 2 + SLEEVE_WALL) + 2;
  if (diameter < Math.max(46, 2 * sleeveR)) {
    issues.push('The base is too small for the wiring bay — widen the base.');
    return null;
  }
  const R = diameter / 2;
  const sleeves = [-1, 1].map((side) => ({
    x: axisX + across[0] * off * side,
    y: axisY + across[1] * off * side,
    along,
    len,
    wid,
    hgt,
  }));

  // Cup screws: 4 inserts in the cup spigot end face, ±63° / ±117° off the exit line, so the flat cord passes
  // between the two pillars either side of the line on its way to the centre bore.
  const rScrew = cordD / 2 + 2 + hw.insert.outerDiameter / 2;
  const screws = [63, 117, 243, 297].map((deg) => ({
    x: axisX + Math.cos(exitA + deg * DEG) * rScrew,
    y: axisY + Math.sin(exitA + deg * DEG) * rScrew,
  }));
  const cordPass = 2 * rScrew * Math.sin(63 * DEG) - 2 * hole.wallRadius;
  if (cordPass < (hw.prewiredCord ? hw.plugWidth : hw.cordWidth))
    issues.push('The cord does not fit between the base-screw pillars — use a narrower cord or a smaller insert.');
  const cupScrewMouthZ = baseBottom + b.height - spigotLen;
  // the insert mouths must lie below the deck underside so the pillars (and screws) stay inside the tray
  const minSpigot = Math.max(hole.kind === 'insert' ? hole.depth + 1 : 6, deckT + 1);
  if (spigotLen < minSpigot - 1e-6)
    issues.push(
      `The cup joint spigot is too short for the base screws — raise "Cup joint spigot length" to ≥ ${Math.ceil(minSpigot)} mm.`,
    );

  // cord exit: a box through the wall, hugging the deck underside so it opens upward into the deck seam
  const exitH = (hw.prewiredCord ? hw.plugThickness : hw.cordThickness) + 2 * CORD_CLEAR;
  const exitW = (hw.prewiredCord ? hw.plugWidth : hw.cordWidth) + 2 * CORD_CLEAR;
  const edge = baseEdgeAlong(b, axisX, axisY, along, 0);
  const sIn = R - 1;
  const sOut = (Number.isFinite(edge) ? edge : R + 20) + 3;
  if (depth - exitH < b.bottomEdgeRadius)
    issues.push('The cord exit breaks out of the base edge — move the exit angle or raise the base.');
  else if (depth - exitH < BAY_FLOOR + 0.5)
    issues.push('The cord exit would cut into the tray floor — raise the base or use a thinner cord.');
  const sMid = (sIn + sOut) / 2;
  return {
    diameter,
    depth,
    floor: BAY_FLOOR,
    deckThickness: deckT,
    cupScrewMouthZ,
    spigotRadius: rSpigot,
    sleeves,
    screws,
    hole,
    exit: {
      x: axisX + along[0] * sMid,
      y: axisY + along[1] * sMid,
      z: baseBottom + depth - exitH / 2,
      along,
      width: exitW,
      height: exitH,
      len: sOut - sIn,
    },
  };
}

/** Height of the transverse ridges on the cord side of the clamp bar. */
export const CLAMP_RIDGE = 0.6;

/**
 * Screw-down cord clamp: a printed bar presses the cord against a surface and two screws pull it in.
 * Without a wiring bay the bar sits flush in a recess in the underside of a solid plinth, across the cord channel
 * (`inBay` false), pressing the cord up against the roof; with a bay it lies on the tray floor between the cord exit
 * and the sleeves, pressing the cord down, screwed into floor pedestals. Centred at (x, y), `along` = unit XY exit
 * direction, bar bottom at world z.
 */
export interface StrainClamp {
  x: number;
  y: number;
  along: [number, number];
  /** bar length across the cord, width along it, thickness */
  barLen: number;
  barWidth: number;
  thickness: number;
  /** screw centres at ±screwOffset across the cord */
  screwOffset: number;
  /** screw holes: in the base roof opening downward at z + reach (underside clamp), or in floor pedestals opening
   *  upward at z + reach (in-bay clamp) */
  hole: FastenerHole;
  inBay: boolean;
  /** world z of the bar's bottom face */
  z: number;
  /** distance from the bar's bottom face to the screw-hole mouth plane (in-bay: the ridge height, so the plate sits on the pedestals) */
  reach: number;
}

function strainClamp(
  p: LampParams,
  baseBottom: number,
  axisX: number,
  axisY: number,
  bay: WiringBay | null,
  issues: string[],
): StrainClamp | null {
  const hw = p.hardware;
  const sr = hw.strainRelief;
  if (!sr.enabled) return null;
  const b = p.base;
  if (!bay && (b.legs >= 3 || b.shellWall > 0 || !b.cordChannel)) {
    issues.push(
      'The cord clamp sits in the underside cord channel of a solid plinth — enable the cord channel on a solid, leg-free base, or disable it and rely on an Underwriters knot at the socket.',
    );
    return null;
  }
  const ct = hw.prewiredCord ? hw.plugThickness : hw.cordThickness;
  const channelW = (hw.prewiredCord ? hw.plugWidth : hw.cordWidth) + 2 * CORD_CLEAR;
  const channelH = ct + 2 * CORD_CLEAR;
  // bar top = channel roof − cord thickness + squeeze, bar bottom flush with the underside (or the roof − channel)
  const thickness = channelH - hw.cordThickness + sr.squeeze;
  const hole = fastenerHole(hw, sr.screwDiameter);
  const d = hole.screw;
  const screwOffset = channelW / 2 + hole.wallRadius;
  const barLen = 2 * screwOffset + d + 4;
  const barWidth = Math.max(10, 2 * d + 4);
  if (thickness < 1.6)
    issues.push(`Cord clamp bar would be only ${thickness.toFixed(1)} mm thick — increase the squeeze.`);
  const exit = (b.cordExitAngle * Math.PI) / 180;
  const along: [number, number] = [Math.cos(exit), Math.sin(exit)];
  const across: [number, number] = [-along[1], along[0]];

  if (bay) {
    // The bar lies on the cord on the tray floor and presses it down; two screws drive down through the bar into
    // floor pedestals (reachable while the deck is off). The bar's plate sits on the pedestal tops; its ridges hang
    // down onto the cord, so `reach` (bar bottom → pedestal top) is the ridge length.
    const zBar = baseBottom + bay.floor + ct - sr.squeeze;
    const pedestalTop = zBar + CLAMP_RIDGE;
    // pilot depth available in the pedestal + floor without breaking through the underside (≥ 2 × the screw diameter)
    const engage = pedestalTop - baseBottom - 1;
    if (engage < (hole.kind === 'insert' ? hole.depth - 1 : 2 * hole.screw))
      issues.push('Base is too low for the cord clamp screws inside the wiring bay — raise the base or use a thinner cord.');
    const R = bay.diameter / 2;
    // furthest the bar can sit with both its outer corners inside the round bay wall
    const sMax = Math.sqrt(Math.max(0, (R - 1) ** 2 - (barLen / 2) ** 2)) - barWidth / 2;
    const sleeveEnd = bay.sleeves[0].len / 2 + 1.5;
    if (sMax - barWidth / 2 < sleeveEnd)
      issues.push('Base is too small for the cord clamp inside the wiring bay — widen the base or disable the clamp.');
    return {
      x: axisX + along[0] * sMax,
      y: axisY + along[1] * sMax,
      along,
      barLen,
      barWidth,
      thickness,
      screwOffset,
      hole,
      inBay: true,
      z: zBar,
      reach: pedestalTop - zBar,
    };
  }

  if (thickness + hole.depth > b.height - 1.5)
    issues.push(
      `Base is too low for the cord clamp screws (needs ≥ ${(thickness + hole.depth + 1.5).toFixed(1)} mm) — raise the base or use smaller screws.`,
    );
  // distance from the axis to the base edge along the exit, at the underside
  const edge = baseEdgeAlong(b, axisX, axisY, along, b.bottomEdgeRadius);
  const sClamp = edge - 6 - barWidth / 2;
  // keep clear of the cord bore (on the axis) and the weight pocket (on the origin)
  const cordR = cordBoreDiameter(hw) / 2 + 2;
  const x = axisX + along[0] * sClamp;
  const y = axisY + along[1] * sClamp;
  let fits = sClamp - barWidth / 2 >= cordR;
  let nearest = Infinity;
  for (const [i, j] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0]]) {
    const cx = x + (along[0] * i * barWidth) / 2 + (across[0] * j * barLen) / 2;
    const cy = y + (along[1] * i * barWidth) / 2 + (across[1] * j * barLen) / 2;
    nearest = Math.min(nearest, Math.hypot(cx, cy));
    if (Math.hypot(cx, cy) > sectionRadius(b.section, Math.atan2(cy, cx)) * b.size - b.bottomEdgeRadius - 1.5) fits = false;
  }
  if (!fits)
    issues.push('Base is too small for the cord clamp between the cord bore and the edge — widen the base or disable the clamp.');
  else if (b.weightPocketDiameter > 0 && nearest < b.weightPocketDiameter / 2 + 1.6)
    issues.push('Cord clamp overlaps the weight pocket — shrink the weight pocket or disable the clamp.');
  return { x, y, along, barLen, barWidth, thickness, screwOffset, hole, inBay: false, z: baseBottom, reach: thickness };
}

/**
 * Translucent inner wall (liner) standing on the hub (spider / fitter) or the base top, inside the shade with an air
 * gap. Built at one constant radius — the narrowest shade inner wall between its seat and the rim, minus the gap — so
 * it can never wedge while it is dropped in from above (or while the shade is lowered over it).
 */
export interface LinerPlan {
  /** world z of the liner's bottom edge (its seat) */
  seatZ: number;
  /** world z of the liner's top edge (open) */
  topZ: number;
  /** constant outer radius the whole liner is built at */
  outerR: number;
  /** radius of the locating groove / rail centre at the seat (liner mid-wall at its foot) */
  seatR: number;
}

/** Locating features for the liner foot: rails on the hub top face, a groove in the base top. */
export const LINER_RAIL_T = 1.6;
export const LINER_RAIL_H = 2;
/** Height of the stepped-in locating foot at the liner's bottom edge. */
export const LINER_FOOT_H = 3;
/** Depth of the liner groove cut into the base top (base / lip mounts). */
export const LINER_GROOVE_DEPTH = 2.5;

/** Hub outer diameter that holds the liner rails (spider / fitter mounts); the configured diameter if it is already enough. */
function hubDiameterFor(p: LampParams, liner: LinerPlan | null): number {
  const sh = p.shade;
  if (!liner || (sh.mount !== 'spider' && sh.mount !== 'fitter')) return sh.hubOuterDiameter;
  const need = 2 * (liner.seatR + Math.max(0.4, sh.diffuser.thickness) / 2 + sh.diffuser.seatClearance + LINER_RAIL_T) + 4;
  return Math.max(sh.hubOuterDiameter, need);
}

/** Narrowest shade inner wall over t ∈ [t0, t1] and all angles. */
function minInnerRadius(S: ShadeSurface, t0: number, t1: number): number {
  let r = Infinity;
  const n = 12;
  for (const phi of angles(72)) for (let i = 0; i <= n; i++) r = Math.min(r, S.innerRadius(t0 + ((t1 - t0) * i) / n, phi));
  return r;
}

function linerPlan(p: LampParams, l: Omit<Layout, 'liner' | 'hubOuterDiameter'>, issues: string[]): LinerPlan | null {
  const sh = p.shade;
  const df = sh.diffuser;
  if (df.position === 'none') return null;
  const t = Math.max(0.4, df.thickness);
  const seated = sh.mount === 'base' || sh.mount === 'lip';
  if (!seated && sh.topClosure !== 'open') {
    issues.push('A diffuser liner needs the open shade top — set the top closure to open.');
    return null;
  }
  const seatZ = seated ? l.baseTop : l.hubBottom + l.hubThickness;
  const H = Math.max(1e-6, l.shade.height);
  const tSeat = Math.min(1, Math.max(0, (seatZ - l.shadeBottom) / H));
  const topZ = Math.min(l.shadeTop - 5, seatZ + (df.height > 0 ? df.height : l.shadeTop - 10 - seatZ));
  if (topZ - seatZ < 20) {
    issues.push('No room for the diffuser liner under the shade top — make the shade taller.');
    return null;
  }
  const gap = Math.max(0, df.gap);
  const outerR = minInnerRadius(l.shade, tSeat, 1) - gap;
  // seated liners are placed first and the shade is lowered over them: the shade's lower part must pass the liner
  if (seated && minInnerRadius(l.shade, 0, tSeat) < outerR + 0.2) {
    issues.push('Shade narrows above the base top — the liner cannot pass; widen the shade or reduce the gap.');
    return null;
  }
  // the foot is stepped in by half a wall, so its inner face is the closest part to the bulb
  const innerR = outerR - 1.5 * t;
  let bulbR = 0;
  for (const [z, r] of l.bulbProfile) if (z >= seatZ && z <= topZ) bulbR = Math.max(bulbR, r);
  if (innerR <= bulbR + 3) {
    issues.push('The diffuser liner would touch the bulb — increase the gap or widen the shade.');
    return null;
  }
  return { seatZ, topZ, outerR, seatR: outerR - t };
}

export interface Layout {
  axisX: number;
  axisY: number;
  baseBottom: number;
  baseTop: number;
  stemTop: number;
  cupTop: number;
  /** z of the shade hub's bottom face (spider / fitter mounts), else NaN */
  hubBottom: number;
  hubThickness: number;
  /** socket body bottom and top rim */
  socketBottom: number;
  socketTop: number;
  /** shade ring bottom face (ring mode), else NaN */
  ringBottom: number;
  contactZ: number;
  bulb: BulbShape;
  /** bulb envelope [z_world, r] polyline from the contact to the tip */
  bulbProfile: Array<[number, number]>;
  bulbTop: number;
  shadeBottom: number;
  shadeTop: number;
  /** resolved shade sizes (after 'clearance' auto-sizing) */
  shadeBottomSize: number;
  shadeTopSize: number;
  shade: ShadeSurface;
  /** hub hole diameter needed for the hardware passing through it */
  hubHoleDiameter: number;
  /** total height of the assembled lamp */
  totalHeight: number;
  /** human-readable problems with the stack itself (not safety) */
  issues: string[];
  /** base.legs ≥ 3: one axis per leg (printed or dowel), else empty */
  legs: LegAxis[];
  /** wiring bay in the base underside (hardware.wago.enabled), else null */
  bay: WiringBay | null;
  /** screw-down cord clamp under the base (hardware.strainRelief.enabled), else null */
  clamp: StrainClamp | null;
  /** shade.diffuser.position ≠ 'none' and it fits, else null */
  liner: LinerPlan | null;
  /** effective hub outer diameter: the configured one, grown to carry the liner rails when needed */
  hubOuterDiameter: number;
}

export function bulbFor(p: LampParams): BulbShape {
  return (
    BULB_SHAPES.find((b) => b.id === p.bulb.shape && b.base === p.hardware.socketBase) ??
    BULB_SHAPES.find((b) => b.base === p.hardware.socketBase)!
  );
}

/** Radial distance from a point (r, z) in the axial half-plane to the bulb envelope; negative = inside. */
export function distanceToBulb(profile: Array<[number, number]>, r: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < profile.length - 1; i++) {
    const [z0, r0] = profile[i];
    const [z1, r1] = profile[i + 1];
    const dz = z1 - z0;
    const dr = r1 - r0;
    const len2 = dz * dz + dr * dr;
    const u = len2 > 0 ? Math.min(1, Math.max(0, ((z - z0) * dz + (r - r0) * dr) / len2)) : 0;
    best = Math.min(best, Math.hypot(z - (z0 + u * dz), r - (r0 + u * dr)));
  }
  const zMin = profile[0][0];
  const zMax = profile[profile.length - 1][0];
  if (z >= zMin && z <= zMax) {
    // inside test: compare with the envelope radius at this z
    for (let i = 0; i < profile.length - 1; i++) {
      const [z0, r0] = profile[i];
      const [z1, r1] = profile[i + 1];
      if (z >= Math.min(z0, z1) && z <= Math.max(z0, z1) && z1 !== z0) {
        if (r < r0 + ((z - z0) / (z1 - z0)) * (r1 - r0)) return -best;
        break;
      }
    }
  }
  return best;
}

/** Sampling resolution used by clearance searches (independent of export quality). */
const CLEAR_T = 48;
const CLEAR_PHI = 72;

/** Minimum distance from the shade's nominal inner wall to the bulb envelope, and where it occurs. */
export function shadeBulbClearance(
  surface: ShadeSurface,
  shadeBottom: number,
  profile: Array<[number, number]>,
  axisOffset = 0,
): { distance: number; t: number; phi: number } {
  let best = { distance: Infinity, t: 0, phi: 0 };
  for (let i = 0; i <= CLEAR_T; i++) {
    const t = i / CLEAR_T;
    const z = shadeBottom + t * surface.height;
    for (let j = 0; j < CLEAR_PHI; j++) {
      const phi = (j / CLEAR_PHI) * Math.PI * 2;
      const d = distanceToBulb(profile, surface.innerRadius(t, phi) - axisOffset, z);
      if (d < best.distance) best = { distance: d, t, phi };
    }
  }
  return best;
}

export function computeLayout(p: LampParams): Layout {
  const issues: string[] = [];
  const hw = p.hardware;
  const sock = hw.socket;
  const sh = p.shade;
  const axisX = p.stem.height > 0 ? p.stem.offsetX : 0;
  const axisY = p.stem.height > 0 ? p.stem.offsetY : 0;
  const baseBottom = p.base.legs >= 3 ? Math.max(0, p.base.legHeight) : 0;
  const legs: LegAxis[] = [];
  if (p.base.legs >= 3) {
    const b = p.base;
    const count = Math.round(b.legs);
    const dowel = b.legKind === 'dowel';
    // radius of the leg (or dowel sleeve) where it meets the base, and of its foot on the table
    const rTop = dowel ? (b.dowelDiameter + b.dowelClearance) / 2 + b.dowelSleeveWall : b.legDiameter / 2;
    const rFoot = dowel ? b.dowelDiameter / 2 : b.legTipDiameter / 2;
    let inradius = Infinity;
    for (const phi of angles(p.quality.radialSegments)) inradius = Math.min(inradius, sectionRadius(b.section, phi) * b.size);
    const rootR = Math.min(Math.max(0, b.legRootRadius), Math.max(0, inradius - rTop));
    // axes start just under the base top skin so a printed leg's union with the base is solid
    const zTop = baseBottom + Math.max(1, b.height - Math.max(1.5, b.shellWall));
    const rTip = b.legSpread / 2 - rFoot;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.PI / count + (b.cordExitAngle * Math.PI) / 180;
      legs.push({
        top: [Math.cos(a) * rootR, Math.sin(a) * rootR, zTop],
        tip: [Math.cos(a) * rTip, Math.sin(a) * rTip, dowel ? 0 : rFoot],
      });
    }
  }
  const baseTop = baseBottom + p.base.height;
  const stemTop = baseTop + Math.max(0, p.stem.height);
  const cupTop = stemTop + p.cup.height;
  const hasHub = sh.mount === 'spider' || sh.mount === 'fitter';
  const hubThickness = hasHub ? sh.hubThickness : 0;
  const hubBottom = hasHub ? cupTop : NaN;

  let socketBottom: number;
  let socketTop: number;
  let ringBottom = NaN;
  if (hw.socketMount === 'ring') {
    // Shade ring sits on the hub (or plate); the skirt must reach through plate + hub + ring.
    ringBottom = cupTop + hubThickness;
    socketTop = ringBottom + sock.ringThickness + 2;
    socketBottom = socketTop - sock.bodyLength;
    const needed = socketTop - (cupTop - p.cup.plateThickness);
    if (sock.skirtLength < needed)
      issues.push(
        `Socket skirt (${sock.skirtLength} mm) is shorter than plate + hub + ring stack (${needed.toFixed(1)} mm).`,
      );
    if (socketBottom < stemTop + 2)
      issues.push('Socket body is longer than the cup cavity — increase cup height.');
  } else if (hw.socketMount === 'snap') {
    // Face flange rests on the hub (or plate); the clip wings grip the whole sandwich from underneath.
    socketTop = cupTop + hubThickness;
    socketBottom = socketTop - sock.bodyLength;
    const grip = p.cup.plateThickness + hubThickness;
    if (grip < sock.gripMin - 1e-6 || grip > sock.gripMax + 1e-6)
      issues.push(
        `Snap-in clips grip ${sock.gripMin}–${sock.gripMax} mm but the plate${hubThickness > 0 ? ' + hub' : ''} is ${grip.toFixed(1)} mm — set the cup plate thickness${hubThickness > 0 ? ' and hub thickness' : ''} into that range.`,
      );
    if (sock.flangeDiameter <= sock.snapHoleDiameter + p.cup.clearance)
      issues.push('Snap-in socket flange is not wider than its mounting hole — it would fall through.');
    if (socketBottom < stemTop + 2)
      issues.push('Snap-in socket body is longer than the cup cavity — increase cup height.');
  } else {
    socketBottom = cupTop + hubThickness;
    socketTop = socketBottom + sock.bodyLength;
  }
  const contactZ = socketTop - sock.contactDepth;

  const bulb = bulbFor(p);
  const profile = bulbProfile(bulb, p.bulb.diameterOverride, p.bulb.lengthOverride).map(
    ([z, r]) => [z + contactZ, r] as [number, number],
  );
  const bulbTop = profile[profile.length - 1][0];

  const shadeBottom =
    sh.mount === 'base'
      ? baseTop - sh.baseGrooveDepth
      : sh.mount === 'lip'
        ? baseTop
        : (hasHub ? hubBottom : cupTop) - sh.mountHeight;

  let bottomSize = sh.bottomSize;
  let topSize = sh.topSize;
  if (sh.sizing === 'clearance') {
    // Scale both sizes uniformly so the nearest inner-wall point is exactly bulbClearance from the bulb.
    const at = (k: number) =>
      shadeBulbClearance(shadeSurface(sh, sh.bottomSize * k, sh.topSize * k), shadeBottom, profile).distance;
    let lo = 0.05;
    let hi = 1;
    while (at(hi) < sh.bulbClearance && hi < 64) hi *= 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < sh.bulbClearance) lo = mid;
      else hi = mid;
    }
    bottomSize = sh.bottomSize * hi;
    topSize = sh.topSize * hi;
  }
  const surface = shadeSurface(sh, bottomSize, topSize);
  const shadeTop = shadeBottom + sh.height;

  const hubHoleDiameter =
    (hw.socketMount === 'ring' ? sock.skirtDiameter : hw.socketMount === 'snap' ? sock.snapHoleDiameter : hw.nippleDiameter) +
    p.cup.clearance;
  if (hasHub && sh.hubOuterDiameter <= hubHoleDiameter + 4)
    issues.push('Shade hub outer diameter is too small for the socket hole.');
  if (sh.mount === 'base' || sh.mount === 'lip') {
    // compare the real rim (after shoulder rounding / ripples) with the base top
    const topSize = p.base.size * p.base.topScale;
    let rimTooWide = false;
    for (let i = 0; i < 72 && !rimTooWide; i++) {
      const phi = (i / 72) * Math.PI * 2;
      const twistTop = (p.base.twist * Math.PI) / 180;
      const rBase = sectionRadius(p.base.section, phi - twistTop) * topSize;
      const rShade = sh.mount === 'lip' ? surface.innerRadius(0, phi) : surface.outerRadius(0, phi);
      if (rShade > rBase + 0.01) rimTooWide = true;
    }
    if (rimTooWide)
      issues.push(
        sh.mount === 'lip'
          ? 'Shade inner wall is wider than the base top — the lip would overhang the base edge.'
          : 'Base-mounted shade is wider than the base top; the groove would cut off the base edge.',
      );
  }
  if (sh.mount === 'lip' && p.cup.size / 2 > surface.innerRadius(0, 0) - sh.baseGrooveClearance - 2.4)
    issues.push('Socket cup is wider than the lip opening — reduce the cup size or widen the shade.');

  const bay = wiringBay(p, baseBottom, axisX, axisY, issues);
  const clamp = strainClamp(p, baseBottom, axisX, axisY, bay, issues);
  const base: Omit<Layout, 'liner' | 'hubOuterDiameter'> = {
    axisX,
    axisY,
    baseBottom,
    baseTop,
    stemTop,
    cupTop,
    hubBottom,
    hubThickness,
    socketBottom,
    socketTop,
    ringBottom,
    contactZ,
    bulb,
    bulbProfile: profile,
    bulbTop,
    shadeBottom,
    shadeTop,
    shadeBottomSize: bottomSize,
    shadeTopSize: topSize,
    shade: surface,
    hubHoleDiameter,
    totalHeight: Math.max(shadeTop, bulbTop, socketTop),
    issues,
    legs,
    bay,
    clamp,
  };
  const liner = linerPlan(p, base, issues);
  return { ...base, liner, hubOuterDiameter: hubDiameterFor(p, liner) };
}
