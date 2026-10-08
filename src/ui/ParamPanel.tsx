import { BULB_SHAPES, BULB_TECH, MATERIALS, SOCKET_PRESETS } from '../model/hardware';
import type { BulbTech, EdgeStyle, LampParams, MaterialId, SocketBase, SocketMount } from '../model/params';
import { Collapsible, Note, SubHeading, type Option } from './controls';
import { makeFields } from './fields';
import { PRESETS } from './presets';
import { SectionEditor } from './SectionEditor';
import { ShadePanel } from './ShadePanel';
import type { PanelProps } from './types';

const BASES: Array<Option<SocketBase>> = [
  { value: 'E26', label: 'E26 (medium)' },
  { value: 'E12', label: 'E12 (candelabra)' },
];
const MOUNTS: Array<Option<SocketMount>> = [
  { value: 'ring', label: 'Threaded skirt + shade ring' },
  { value: 'nipple', label: '1/8 IPS nipple + nut' },
];
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
                d.hardware.socket = { ...SOCKET_PRESETS[base.value] };
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
        {f.sel('Socket mount', (d) => d.hardware, 'socketMount', MOUNTS)}
        <button
          type="button"
          onClick={() =>
            edit((d) => {
              d.hardware.socket = { ...SOCKET_PRESETS[d.hardware.socketBase] };
            })
          }
        >
          Reset socket dimensions to {hw.socketBase} preset
        </button>
        <SubHeading>Socket dimensions</SubHeading>
        {f.num('Body diameter', (d) => d.hardware.socket, 'bodyDiameter', 8, 80, 0.1, 'mm')}
        {f.num('Body length', (d) => d.hardware.socket, 'bodyLength', 15, 120, 0.1, 'mm')}
        {f.num('Skirt diameter', (d) => d.hardware.socket, 'skirtDiameter', 8, 80, 0.1, 'mm')}
        {f.num('Skirt length', (d) => d.hardware.socket, 'skirtLength', 2, 60, 0.1, 'mm')}
        {f.num('Shade ring diameter', (d) => d.hardware.socket, 'ringDiameter', 15, 100, 0.1, 'mm')}
        {f.num('Shade ring thickness', (d) => d.hardware.socket, 'ringThickness', 1, 20, 0.1, 'mm')}
        {f.num('Contact depth', (d) => d.hardware.socket, 'contactDepth', 2, 60, 0.1, 'mm', 'Socket top rim down to the bulb centre contact')}
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
        {f.num('Size', (d) => d.base, 'size', 60, 400, 1, 'mm')}
        {f.num('Height', (d) => d.base, 'height', 6, 100, 0.5, 'mm')}
        {f.num('Top scale', (d) => d.base, 'topScale', 0.3, 1.5, 0.01)}
        {f.num('Twist', (d) => d.base, 'twist', -180, 180, 1, '°')}
        {f.sel('Edge style', (d) => d.base, 'edgeStyle', EDGES)}
        {f.num('Top edge radius', (d) => d.base, 'topEdgeRadius', 0, 30, 0.5, 'mm')}
        {f.num('Bottom edge radius', (d) => d.base, 'bottomEdgeRadius', 0, 30, 0.5, 'mm')}
        {f.num('Weight pocket diameter', (d) => d.base, 'weightPocketDiameter', 0, 300, 1, 'mm', '0 = none')}
        {p.base.weightPocketDiameter > 0 && f.num('Weight pocket depth', (d) => d.base, 'weightPocketDepth', 1, 60, 0.5, 'mm')}
        {f.tog('Cord channel on the underside', (d) => d.base, 'cordChannel')}
        {p.base.cordChannel && f.num('Cord exit angle', (d) => d.base, 'cordExitAngle', -180, 180, 1, '°')}
        {f.num('Felt-pad recess count', (d) => d.base, 'feetCount', 0, 8, 1)}
        {p.base.feetCount > 0 && (
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
