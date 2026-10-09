import { BULB_SHAPES, BULB_TECH, DOWEL_MATERIALS, MATERIALS, WAGO_CONNECTORS, socketPreset } from '../model/hardware';
import type { BulbTech, DowelMaterial, EdgeStyle, LampParams, LegKind, MaterialId, SocketBase, SocketMount, WagoModel } from '../model/params';
import { Collapsible, Note, SubHeading, type Option } from './controls';
import { makeFields } from './fields';
import { PRESETS } from './presets';
import { SectionEditor } from './SectionEditor';
import { ShadePanel } from './ShadePanel';
import { TextureEditor } from './TextureEditor';
import type { PanelProps } from './types';

const BASES: Array<Option<SocketBase>> = [
  { value: 'E26', label: 'E26 (medium)' },
  { value: 'E12', label: 'E12 (candelabra)' },
];
const MOUNTS: Array<Option<SocketMount>> = [
  { value: 'ring', label: 'Threaded skirt + shade ring' },
  { value: 'nipple', label: '1/8 IPS nipple + nut' },
  { value: 'snap', label: 'Snap-in porcelain (spring-clip wings)' },
];
const WAGO_OPTIONS: Array<Option<WagoModel>> = (Object.keys(WAGO_CONNECTORS) as WagoModel[]).map((value) => ({
  value,
  label: WAGO_CONNECTORS[value].label,
}));
const TECHS: Array<Option<BulbTech>> = (Object.keys(BULB_TECH) as BulbTech[]).map((value) => ({
  value,
  label: BULB_TECH[value].label,
}));
const MATERIAL_OPTIONS: Array<Option<MaterialId>> = (Object.keys(MATERIALS) as MaterialId[]).map((value) => ({
  value,
  label: `${MATERIALS[value].label} (HDT ${MATERIALS[value].hdt} °C)`,
}));
const EDGES: Array<Option<EdgeStyle>> = [
  { value: 'fillet', label: 'Fillet' },
  { value: 'chamfer', label: 'Chamfer' },
];
const JOINTS: Array<Option<'fused' | 'spigot'>> = [
  { value: 'spigot', label: 'Separate parts, press-fit spigot' },
  { value: 'fused', label: 'Fused (one printed body)' },
];
const LEG_KINDS: Array<Option<LegKind>> = [
  { value: 'printed', label: 'Printed (part of the base)' },
  { value: 'dowel', label: 'Dowels / rods in printed sockets' },
];
const DOWEL_OPTIONS: Array<Option<DowelMaterial>> = (Object.keys(DOWEL_MATERIALS) as DowelMaterial[]).map((value) => ({
  value,
  label: DOWEL_MATERIALS[value].label,
}));

export interface ParamPanelProps extends PanelProps {
  onReplace(next: LampParams): void;
  onReset(): void;
}

export function ParamPanel({ p, edit, onReplace, onReset }: ParamPanelProps) {
  const f = makeFields(p, edit);
  const hw = p.hardware;
  const shapes: Array<Option<string>> = BULB_SHAPES.filter((b) => b.base === hw.socketBase).map((b) => ({
    value: b.id,
    label: b.label,
  }));

  return (
    <div className="param-panel">
      <Collapsible title="Presets" defaultOpen>
        {f.text('Lamp name', (d) => d, 'name')}
        <div className="preset-list">
          {PRESETS.map((preset) => (
            <button key={preset.id} type="button" title={preset.description} onClick={() => onReplace(structuredClone(preset.params))}>
              {preset.name}
            </button>
          ))}
        </div>
        <button type="button" className="danger" onClick={onReset}>
          Reset to defaults
        </button>
      </Collapsible>

      <Collapsible title="Hardware (purchased parts)">
        <Note>Vendors differ — measure your socket and edit the dimensions.</Note>
        <div className="field select">
          <label htmlFor="socket-base">Socket base</label>
          <select
            id="socket-base"
            value={hw.socketBase}
            onChange={(e) => {
              const base = BASES.find((b) => b.value === e.target.value);
              if (!base) return;
              edit((d) => {
                d.hardware.socketBase = base.value;
                d.hardware.socket = socketPreset(base.value, d.hardware.socketMount);
                if (!BULB_SHAPES.some((b) => b.id === d.bulb.shape && b.base === base.value)) {
                  const match = BULB_SHAPES.find((b) => b.base === base.value);
                  if (match) d.bulb.shape = match.id;
                }
              });
            }}
          >
            {BASES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field select">
          <label htmlFor="socket-mount">Socket mount</label>
          <select
            id="socket-mount"
            value={hw.socketMount}
            onChange={(e) => {
              const mount = MOUNTS.find((m) => m.value === e.target.value);
              if (!mount) return;
              edit((d) => {
                // snap-in sockets are a different body: swap in their preset when crossing that boundary
                if ((mount.value === 'snap') !== (d.hardware.socketMount === 'snap'))
                  d.hardware.socket = socketPreset(d.hardware.socketBase, mount.value);
                d.hardware.socketMount = mount.value;
              });
            }}
          >
            {MOUNTS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() =>
            edit((d) => {
              d.hardware.socket = socketPreset(d.hardware.socketBase, d.hardware.socketMount);
            })
          }
        >
          Reset socket dimensions to {hw.socketBase} {hw.socketMount === 'snap' ? 'snap-in ' : ''}preset
        </button>
        <SubHeading>Socket dimensions</SubHeading>
        {f.num('Body diameter', (d) => d.hardware.socket, 'bodyDiameter', 8, 80, 0.1, 'mm')}
        {f.num('Body length', (d) => d.hardware.socket, 'bodyLength', 15, 120, 0.1, 'mm', hw.socketMount === 'snap' ? 'Behind the panel: face flange to the back of the body' : undefined)}
        {hw.socketMount === 'ring' && (
          <>
            {f.num('Skirt diameter', (d) => d.hardware.socket, 'skirtDiameter', 8, 80, 0.1, 'mm')}
            {f.num('Skirt length', (d) => d.hardware.socket, 'skirtLength', 2, 60, 0.1, 'mm')}
            {f.num('Shade ring diameter', (d) => d.hardware.socket, 'ringDiameter', 15, 100, 0.1, 'mm')}
            {f.num('Shade ring thickness', (d) => d.hardware.socket, 'ringThickness', 1, 20, 0.1, 'mm')}
          </>
        )}
        {hw.socketMount === 'snap' && (
          <>
            {f.num('Mounting hole', (d) => d.hardware.socket, 'snapHoleDiameter', 10, 60, 0.1, 'mm', 'E26 porcelain: 1-17/32 in ≈ 38.9 mm; E12: 1 in = 25.4 mm')}
            {f.num('Face flange diameter', (d) => d.hardware.socket, 'flangeDiameter', 12, 80, 0.1, 'mm', 'Front face that rests on the panel')}
            {f.num('Clip wing reach', (d) => d.hardware.socket, 'clipReach', 10, 80, 0.1, 'mm', 'Across the relaxed spring wings, behind the panel')}
            {f.num('Grip: min panel', (d) => d.hardware.socket, 'gripMin', 0.3, 6, 0.1, 'mm')}
            {f.num('Grip: max panel', (d) => d.hardware.socket, 'gripMax', 0.5, 8, 0.1, 'mm', 'Typical 0.032–0.093 in (0.8–2.4 mm); the cup plate (+ hub) must fall inside')}
          </>
        )}
        {f.num('Contact depth', (d) => d.hardware.socket, 'contactDepth', 2, 60, 0.1, 'mm', hw.socketMount === 'snap' ? 'Face flange (panel top) down to the bulb centre contact' : 'Socket top rim down to the bulb centre contact')}
        {f.num('Rated watts', (d) => d.hardware.socket, 'ratedWatts', 4, 660, 1, 'W')}
        <SubHeading>Nipple, nut & cord</SubHeading>
        {f.num('Nipple diameter', (d) => d.hardware, 'nippleDiameter', 5, 20, 0.01, 'mm', '1/8 IPS = 10.29 mm')}
        {f.num('Nut across flats', (d) => d.hardware, 'nutAcrossFlats', 8, 30, 0.1, 'mm')}
        {f.num('Nut thickness', (d) => d.hardware, 'nutThickness', 1, 12, 0.1, 'mm')}
        {f.num('Cord width', (d) => d.hardware, 'cordWidth', 2, 20, 0.1, 'mm')}
        {f.num('Cord thickness', (d) => d.hardware, 'cordThickness', 1, 12, 0.1, 'mm')}
        {f.tog('Cord set comes with plug attached', (d) => d.hardware, 'prewiredCord', 'The plug must pass through the cord path')}
        {hw.prewiredCord && (
          <>
            {f.num('Plug width', (d) => d.hardware, 'plugWidth', 10, 50, 0.5, 'mm')}
            {f.num('Plug thickness', (d) => d.hardware, 'plugThickness', 8, 40, 0.5, 'mm')}
          </>
        )}
        <SubHeading>Cord strain relief</SubHeading>
        {f.tog('Screw-down cord clamp under the base', (d) => d.hardware.strainRelief, 'enabled', 'Printed bar in a recess across the cord channel (solid plinth with cord channel)')}
        {hw.strainRelief.enabled && (
          <>
            {f.num('Screw size', (d) => d.hardware.strainRelief, 'screwDiameter', 2, 5, 0.5, 'mm', 'Self-tapping pan-head screws: M3 / #4 = 3')}
            {f.num('Cord squeeze', (d) => d.hardware.strainRelief, 'squeeze', 0.2, 2, 0.1, 'mm', 'How far the ridges press into the cord jacket (≈ 20 % of the cord thickness)')}
          </>
        )}
        <SubHeading>Splice connectors</SubHeading>
        {f.tog('WAGO holders under the base', (d) => d.hardware.wago, 'enabled', 'Two pockets (one per conductor) beside the cord bore; solid base only')}
        {hw.wago.enabled && (
          <>
            <div className="field select">
              <label htmlFor="wago-model">Connector</label>
              <select
                id="wago-model"
                value={hw.wago.model}
                onChange={(e) => {
                  const model = WAGO_OPTIONS.find((o) => o.value === e.target.value);
                  if (!model) return;
                  edit((d) => {
                    const c = WAGO_CONNECTORS[model.value];
                    d.hardware.wago = { ...d.hardware.wago, model: model.value, width: c.width, height: c.height, depth: c.depth };
                  });
                }}
              >
                {WAGO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {f.num('Connector width', (d) => d.hardware.wago, 'width', 4, 40, 0.1, 'mm', 'Across the wire entries')}
            {f.num('Connector height', (d) => d.hardware.wago, 'height', 3, 30, 0.1, 'mm', 'Levers closed')}
            {f.num('Connector depth', (d) => d.hardware.wago, 'depth', 6, 40, 0.1, 'mm', 'Along the wires')}
            {f.num('Pocket clearance', (d) => d.hardware.wago, 'clearance', 0, 1, 0.05, 'mm', 'Per side: ≈ 0.1 snug, 0.2 normal, 0.3 loose (crush ribs still hold it)')}
            <Note>{WAGO_CONNECTORS[hw.wago.model].source}. Strip {WAGO_CONNECTORS[hw.wago.model].strip} mm.</Note>
          </>
        )}
      </Collapsible>

      <Collapsible title="Bulb">
        {f.sel('Shape', (d) => d.bulb, 'shape', shapes)}
        {f.sel('Technology', (d) => d.bulb, 'tech', TECHS)}
        {f.num('Actual watts', (d) => d.bulb, 'watts', 1, 300, 1, 'W')}
        {f.num('Marked (max) watts', (d) => d.bulb, 'markedWatts', 1, 300, 1, 'W', 'Maximum wattage you will mark on the lamp — drives the UL 153 spacing tables')}
        {f.num('Diameter override', (d) => d.bulb, 'diameterOverride', 0, 200, 0.5, 'mm', '0 = catalog value')}
        {f.num('Length override', (d) => d.bulb, 'lengthOverride', 0, 300, 0.5, 'mm', '0 = catalog value')}
      </Collapsible>

      <Collapsible title="Base">
        <SectionEditor
          label="Footprint section"
          section={p.base.section}
          onChange={(next) =>
            edit((d) => {
              d.base.section = next;
            })
          }
        />
        {f.num('Size', (d) => d.base, 'size', 40, 400, 1, 'mm')}
        {f.num('Height', (d) => d.base, 'height', 6, 200, 0.5, 'mm')}
        {f.num('Top scale', (d) => d.base, 'topScale', 0.3, 1.5, 0.01)}
        {f.num('Twist', (d) => d.base, 'twist', -180, 180, 1, '°')}
        {f.sel('Edge style', (d) => d.base, 'edgeStyle', EDGES)}
        {f.num('Top edge radius', (d) => d.base, 'topEdgeRadius', 0, 30, 0.5, 'mm')}
        {f.num('Bottom edge radius', (d) => d.base, 'bottomEdgeRadius', 0, 30, 0.5, 'mm')}
        {f.num('Hollow shell wall', (d) => d.base, 'shellWall', 0, 20, 0.2, 'mm', '0 = solid. Hollow bases are open underneath with a 45° self-supporting roof')}
        <Collapsible title="Base texture" nested>
          <TextureEditor p={p} edit={edit} pick={(d) => d.base.texture} />
        </Collapsible>
        <Collapsible title="Legs (tripod / stand)" nested>
          {f.num('Leg count', (d) => d.base, 'legs', 0, 8, 1, undefined, '0 = base sits on the table; 3+ = splayed legs lift it')}
          {p.base.legs >= 3 && (
            <>
              {f.sel('Leg type', (d) => d.base, 'legKind', LEG_KINDS)}
              {f.num('Leg height', (d) => d.base, 'legHeight', 20, 600, 1, 'mm')}
              {f.num('Spread at the floor', (d) => d.base, 'legSpread', 40, 800, 1, 'mm', 'Diameter of the circle through the leg tips')}
              {p.base.legKind === 'printed' ? (
                <>
                  {f.num('Leg diameter (top)', (d) => d.base, 'legDiameter', 4, 60, 0.5, 'mm')}
                  {f.num('Leg diameter (tip)', (d) => d.base, 'legTipDiameter', 4, 60, 0.5, 'mm')}
                </>
              ) : (
                <>
                  {f.sel('Dowel material', (d) => d.base, 'dowelMaterial', DOWEL_OPTIONS, 'Used for the stability estimate (rod weight)')}
                  {f.num('Dowel diameter', (d) => d.base, 'dowelDiameter', 3, 40, 0.1, 'mm', 'Measure yours: 1/4 in = 6.35, 3/8 in = 9.5, 1/2 in = 12.7, 5/8 in = 15.9')}
                  {f.num('Socket clearance', (d) => d.base, 'dowelClearance', 0, 2, 0.05, 'mm', 'Diametral: ≈ 0.2 press fit, 0.4–0.6 glue fit')}
                  {f.num('Insertion depth', (d) => d.base, 'dowelSocketDepth', 8, 120, 1, 'mm', 'How far each dowel goes into its socket, along the leg')}
                  {f.num('Sleeve wall', (d) => d.base, 'dowelSleeveWall', 1.2, 10, 0.2, 'mm', 'Printed wall around each socket')}
                  <Note>Dowel cut length is listed in the base part notes.</Note>
                </>
              )}
              {f.num('Leg root radius', (d) => d.base, 'legRootRadius', 0, 200, 0.5, 'mm', 'Where the leg axes start under the base')}
            </>
          )}
        </Collapsible>
        {p.base.legs < 3 && p.base.shellWall <= 0 && (
          <>
            {f.num('Weight pocket diameter', (d) => d.base, 'weightPocketDiameter', 0, 300, 1, 'mm', '0 = none')}
            {p.base.weightPocketDiameter > 0 && f.num('Weight pocket depth', (d) => d.base, 'weightPocketDepth', 1, 60, 0.5, 'mm')}
          </>
        )}
        {f.tog('Cord channel / notch', (d) => d.base, 'cordChannel', 'Underside channel (solid base) or rim notch (hollow base)')}
        {p.base.cordChannel && f.num('Cord exit angle', (d) => d.base, 'cordExitAngle', -180, 180, 1, '°')}
        {p.base.legs < 3 && f.num('Felt-pad recess count', (d) => d.base, 'feetCount', 0, 8, 1)}
        {p.base.legs < 3 && p.base.feetCount > 0 && (
          <>
            {f.num('Recess diameter', (d) => d.base, 'feetDiameter', 4, 40, 0.5, 'mm')}
            {f.num('Recess depth', (d) => d.base, 'feetDepth', 0.2, 5, 0.1, 'mm')}
            {f.num('Inset from edge', (d) => d.base, 'feetInset', 2, 80, 0.5, 'mm')}
          </>
        )}
      </Collapsible>

      <Collapsible title="Stem">
        {f.num('Height', (d) => d.stem, 'height', 0, 500, 1, 'mm', '0 = no stem; the cup sits on the base')}
        {p.stem.height > 0 && (
          <>
            <SectionEditor
              label="Stem section"
              section={p.stem.section}
              onChange={(next) =>
                edit((d) => {
                  d.stem.section = next;
                })
              }
            />
            {f.num('Size', (d) => d.stem, 'size', 8, 120, 0.5, 'mm')}
            {f.num('Top scale', (d) => d.stem, 'topScale', 0.3, 1.5, 0.01)}
            {f.num('Twist', (d) => d.stem, 'twist', -360, 360, 1, '°')}
            {f.num('Cord bore diameter', (d) => d.stem, 'boreDiameter', 4, 30, 0.1, 'mm')}
            {f.num('Offset X', (d) => d.stem, 'offsetX', -100, 100, 0.5, 'mm')}
            {f.num('Offset Y', (d) => d.stem, 'offsetY', -100, 100, 0.5, 'mm')}
            <Collapsible title="Joint: base ↔ stem" nested>
              {f.sel('Joint', (d) => d.stem.baseJoint, 'kind', JOINTS)}
              {p.stem.baseJoint.kind === 'spigot' && (
                <>
                  {f.num('Spigot length', (d) => d.stem.baseJoint, 'spigotLength', 2, 50, 0.5, 'mm')}
                  {f.num('Spigot wall', (d) => d.stem.baseJoint, 'spigotWall', 0.8, 8, 0.1, 'mm')}
                  {f.num('Clearance', (d) => d.stem.baseJoint, 'clearance', 0, 1.5, 0.05, 'mm')}
                </>
              )}
            </Collapsible>
            <Collapsible title="Joint: stem ↔ cup" nested>
              {f.sel('Joint', (d) => d.stem.cupJoint, 'kind', JOINTS)}
              {p.stem.cupJoint.kind === 'spigot' && (
                <>
                  {f.num('Spigot length', (d) => d.stem.cupJoint, 'spigotLength', 2, 50, 0.5, 'mm')}
                  {f.num('Spigot wall', (d) => d.stem.cupJoint, 'spigotWall', 0.8, 8, 0.1, 'mm')}
                  {f.num('Clearance', (d) => d.stem.cupJoint, 'clearance', 0, 1.5, 0.05, 'mm')}
                </>
              )}
            </Collapsible>
          </>
        )}
      </Collapsible>

      <Collapsible title="Socket cup">
        <SectionEditor
          label="Cup section"
          section={p.cup.section}
          onChange={(next) =>
            edit((d) => {
              d.cup.section = next;
            })
          }
        />
        {f.num('Size', (d) => d.cup, 'size', 15, 150, 0.5, 'mm')}
        {f.num('Height', (d) => d.cup, 'height', 10, 150, 0.5, 'mm')}
        {f.num('Top scale', (d) => d.cup, 'topScale', 0.3, 1.5, 0.01)}
        {f.num('Plate thickness', (d) => d.cup, 'plateThickness', 1, 12, 0.1, 'mm')}
        {f.num('Cavity diameter', (d) => d.cup, 'cavityDiameter', 0, 140, 0.5, 'mm', '0 = automatic')}
        {f.num('Hole clearance', (d) => d.cup, 'clearance', 0, 2, 0.05, 'mm', 'Diametral clearance around hardware')}
        {f.num('Edge radius', (d) => d.cup, 'edgeRadius', 0, 15, 0.5, 'mm')}
      </Collapsible>

      <ShadePanel p={p} edit={edit} />

      <Collapsible title="Materials">
        {f.sel('Shade material', (d) => d.materials, 'shade', MATERIAL_OPTIONS)}
        {f.sel('Structure material', (d) => d.materials, 'structure', MATERIAL_OPTIONS)}
        {p.shade.diffuser.position !== 'none' &&
          f.sel('Diffuser material', (d) => d.materials, 'diffuser', MATERIAL_OPTIONS, 'Natural / translucent or white filament')}
        {f.num('Heat safety margin', (d) => d.materials, 'heatMargin', 0, 40, 1, '°C', 'Service limit = HDT − margin')}
        {f.num('Ambient temperature', (d) => d.materials, 'ambient', 0, 45, 1, '°C')}
      </Collapsible>

      <Collapsible title="Quality">
        {f.num('Radial segments', (d) => d.quality, 'radialSegments', 24, 512, 4, undefined, 'Segments around the circumference')}
        {f.num('Rings per 10 mm', (d) => d.quality, 'ringsPer10mm', 1, 20, 1, undefined, 'Vertical resolution of the shade')}
      </Collapsible>
    </div>
  );
}
