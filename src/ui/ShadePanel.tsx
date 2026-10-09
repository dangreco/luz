import { useState } from 'react';
import type {
  LampParams,
  PerfPattern,
  ProfileMode,
  RibWave,
  SectionParams,
  ShadeMount,
  ShadeSizing,
  SurfaceStyle,
  TopClosure,
  DiffuserPosition,
} from '../model/params';
import { Collapsible, NumberField, Note, SubHeading, ToggleField, type Option } from './controls';
import { makeFields } from './fields';
import { SectionEditor } from './SectionEditor';
import { TextureEditor } from './TextureEditor';
import type { PanelProps } from './types';

const SIZING: Array<Option<ShadeSizing>> = [
  { value: 'absolute', label: 'Absolute sizes' },
  { value: 'clearance', label: 'Auto-size to bulb clearance' },
];
const PROFILES: Array<Option<ProfileMode>> = [
  { value: 'linear', label: 'Linear (cone / cylinder)' },
  { value: 'bulge', label: 'Bulge' },
  { value: 'custom', label: 'Custom 6-point' },
];
const CLOSURES: Array<Option<TopClosure>> = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'vented', label: 'Vented (holes)' },
];
const MOUNTS: Array<Option<ShadeMount>> = [
  { value: 'lip', label: 'Sleeve over base lip (flush)' },
  { value: 'base', label: 'Seated in base groove' },
  { value: 'spider', label: 'Integrated spider' },
  { value: 'fitter', label: 'Separate fitter' },
];
const STYLES: Array<Option<SurfaceStyle>> = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'ribs', label: 'Ribs / fins / pleats' },
  { value: 'textured', label: 'Textured (knit, knurl, rope, weave)' },
  { value: 'perforated', label: 'Perforated' },
  { value: 'basket', label: 'Woven basket' },
];
const WAVES: Array<Option<RibWave>> = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'square', label: 'Square' },
  { value: 'scallop', label: 'Scallop' },
];
const PATTERNS: Array<Option<PerfPattern>> = [
  { value: 'circles', label: 'Circles' },
  { value: 'hexes', label: 'Hexagons' },
  { value: 'slots', label: 'Slots' },
  { value: 'diamonds', label: 'Diamonds' },
  { value: 'voronoi', label: 'Voronoi lattice' },
];
const DIFFUSER_POSITIONS: Array<Option<DiffuserPosition>> = [
  { value: 'none', label: 'None' },
  { value: 'bottom', label: 'Bottom (under the bulb, spider / fitter mounts)' },
  { value: 'top', label: 'Top (across the top opening)' },
];

const CUSTOM_PROFILE_LABELS = ['Bottom', '20 %', '40 %', '60 %', '80 %', 'Top'];

function sectionsEqual(a: SectionParams, b: SectionParams): boolean {
  return (
    a.kind === b.kind &&
    a.sides === b.sides &&
    a.cornerRadius === b.cornerRadius &&
    a.exponent === b.exponent &&
    a.aspect === b.aspect &&
    a.rotation === b.rotation
  );
}

/** Vase mode needs a single continuous wall: smooth, corrugated ribs, or texture relief. */
function vaseCompatible(s: LampParams['shade']): boolean {
  return s.style === 'smooth' || s.style === 'textured' || (s.style === 'ribs' && s.ribCorrugated);
}

export function ShadePanel({ p, edit }: PanelProps) {
  const f = makeFields(p, edit);
  const s = p.shade;
  const [linkFlag, setLinkFlag] = useState(true);
  const linked = linkFlag && sectionsEqual(s.bottomSection, s.topSection);
  const hasHub = s.mount === 'spider' || s.mount === 'fitter';

  return (
    <Collapsible title="Shade" defaultOpen>
      <Collapsible title="Size & sizing" nested defaultOpen>
        {f.num('Height', (d) => d.shade, 'height', 30, 600, 1, 'mm')}
        {f.sel('Sizing mode', (d) => d.shade, 'sizing', SIZING)}
        {s.sizing === 'clearance' && (
          <>
            {f.num('Bulb clearance', (d) => d.shade, 'bulbClearance', 5, 200, 0.5, 'mm', 'Distance from the bulb envelope to the nearest point of the inner wall')}
            <Note>Bottom / top sizes below set the proportions only; the shade is scaled uniformly to hit the clearance.</Note>
          </>
        )}
        {f.num(s.sizing === 'clearance' ? 'Bottom size (proportion)' : 'Bottom size', (d) => d.shade, 'bottomSize', 20, 600, 1, 'mm')}
        {f.num(s.sizing === 'clearance' ? 'Top size (proportion)' : 'Top size', (d) => d.shade, 'topSize', 20, 600, 1, 'mm')}
        {f.num('Taper curve', (d) => d.shade, 'taperCurve', 0.2, 5, 0.05, undefined, 'Exponent on height: 1 = straight cone')}
      </Collapsible>

      <Collapsible title="Cross-sections" nested>
        <SectionEditor
          label={linked ? 'Section (top = bottom)' : 'Bottom section'}
          section={s.bottomSection}
          onChange={(next) =>
            edit((d) => {
              d.shade.bottomSection = next;
              if (linked) d.shade.topSection = { ...next };
            })
          }
        />
        <ToggleField
          label="Link top section to bottom"
          checked={linked}
          onChange={(on) => {
            setLinkFlag(on);
            if (on) {
              edit((d) => {
                d.shade.topSection = { ...d.shade.bottomSection };
              });
            }
          }}
        />
        {!linked && (
          <SectionEditor
            label="Top section"
            section={s.topSection}
            onChange={(next) =>
              edit((d) => {
                d.shade.topSection = next;
              })
            }
          />
        )}
      </Collapsible>

      <Collapsible title="Profile & twist" nested>
        {f.sel('Profile', (d) => d.shade, 'profile', PROFILES)}
        {s.profile === 'bulge' && (
          <>
            {f.num('Bulge', (d) => d.shade, 'bulge', -0.5, 0.5, 0.01, undefined, 'Fraction of the local size added at the peak')}
            {f.num('Bulge position', (d) => d.shade, 'bulgePosition', 0.1, 0.9, 0.01)}
          </>
        )}
        {s.profile === 'custom' && (
          <>
            <SubHeading>Size multipliers (bottom → top)</SubHeading>
            {s.customProfile.map((v, i) => (
              <NumberField
                key={i}
                label={CUSTOM_PROFILE_LABELS[i] ?? `Point ${i + 1}`}
                value={v}
                min={0.2}
                max={2}
                step={0.01}
                onChange={(next) =>
                  edit((d) => {
                    d.shade.customProfile[i] = next;
                  })
                }
              />
            ))}
          </>
        )}
        {f.num('Twist', (d) => d.shade, 'twist', -360, 360, 1, '°')}
        {f.num('Twist curve', (d) => d.shade, 'twistCurve', 0.2, 5, 0.05, undefined, '1 = linear easing')}
        {f.num('Bottom shoulder rounding', (d) => d.shade, 'bottomRounding', 0, 120, 0.5, 'mm', 'Rounds the bottom rim inward (capsule shoulders)')}
        {f.num('Top shoulder rounding', (d) => d.shade, 'topRounding', 0, 120, 0.5, 'mm', 'Rounds the top rim inward (capsule / dome)')}
        {f.num('Ripples', (d) => d.shade, 'rippleCount', 0, 20, 1, undefined, 'Horizontal soft bulges along the height (0 = none)')}
        {s.rippleCount > 0 && (
          <>
            {f.num('Ripple depth', (d) => d.shade, 'rippleDepth', 0.2, 15, 0.1, 'mm')}
            {f.num('Ripple wobble', (d) => d.shade, 'rippleWobble', 0, 1, 0.01, undefined, 'How much each ripple wanders up and down around the shade')}
          </>
        )}
      </Collapsible>

      <Collapsible title="Wall, rims & top" nested>
        {f.num('Wall thickness', (d) => d.shade, 'wallThickness', 0.4, 8, 0.1, 'mm')}
        {f.num('Rim thickening', (d) => d.shade, 'rimThickening', 0, 6, 0.1, 'mm', 'Extra wall thickness at the top and bottom rims')}
        {f.num('Rim band height', (d) => d.shade, 'rimBand', 1, 30, 0.5, 'mm')}
        {f.sel('Top closure', (d) => d.shade, 'topClosure', CLOSURES)}
        {s.topClosure === 'vented' && (
          <>
            {f.num('Vent count', (d) => d.shade, 'ventCount', 1, 24, 1)}
            {f.num('Vent diameter', (d) => d.shade, 'ventDiameter', 3, 60, 0.5, 'mm')}
          </>
        )}
        {s.topClosure !== 'open' && f.num('Top thickness', (d) => d.shade, 'topThickness', 0.4, 8, 0.1, 'mm')}
      </Collapsible>

      <Collapsible title="Mount" nested>
        {f.sel('Shade mount', (d) => d.shade, 'mount', MOUNTS)}
        {hasHub && (
          <>
            {f.num('Mount height', (d) => d.shade, 'mountHeight', 0, 200, 1, 'mm', 'Distance from the shade bottom edge up to the hub bottom')}
            {f.num('Hub outer diameter', (d) => d.shade, 'hubOuterDiameter', 20, 160, 0.5, 'mm')}
            {f.num('Hub thickness', (d) => d.shade, 'hubThickness', 1, 12, 0.1, 'mm')}
            {f.num('Spoke count', (d) => d.shade, 'spokeCount', 2, 12, 1)}
            {f.num('Spoke width', (d) => d.shade, 'spokeWidth', 1, 30, 0.5, 'mm')}
            {f.num('Spoke thickness', (d) => d.shade, 'spokeThickness', 0.8, 12, 0.1, 'mm')}
            {f.num('Spoke rise', (d) => d.shade, 'spokeRise', 0, 60, 1, '°', 'Spokes rise from hub to wall by this angle')}
          </>
        )}
        {s.mount === 'fitter' && (
          <>
            {f.num('Fitter rim height', (d) => d.shade, 'fitterRimHeight', 2, 40, 0.5, 'mm')}
            {f.num('Fitter clearance', (d) => d.shade, 'fitterClearance', 0, 2, 0.05, 'mm', 'Diametral fit clearance against the shade')}
          </>
        )}
        {(s.mount === 'base' || s.mount === 'lip') && (
          <>
            {f.num(s.mount === 'lip' ? 'Lip height' : 'Groove depth', (d) => d.shade, 'baseGrooveDepth', 1, 30, 0.5, 'mm')}
            {f.num(s.mount === 'lip' ? 'Lip clearance' : 'Groove clearance', (d) => d.shade, 'baseGrooveClearance', 0, 2, 0.05, 'mm', 'Diametral fit clearance')}
          </>
        )}
      </Collapsible>

      <Collapsible title="Surface style" nested defaultOpen>
        {f.sel('Style', (d) => d.shade, 'style', STYLES)}
        {s.style === 'ribs' && (
          <>
            {f.num('Rib count', (d) => d.shade, 'ribCount', 3, 200, 1)}
            {f.num('Rib depth', (d) => d.shade, 'ribDepth', 0.2, 20, 0.1, 'mm')}
            {f.sel('Waveform', (d) => d.shade, 'ribWave', WAVES)}
            {f.num('Rib twist', (d) => d.shade, 'ribTwist', -360, 360, 1, '°', 'Additional twist of the ribs only')}
            {f.tog('Corrugated (inner wall follows ribs)', (d) => d.shade, 'ribCorrugated', 'Off = solid fins on a smooth wall')}
            {f.num('Rib fade at rims', (d) => d.shade, 'ribFade', 0, 0.3, 0.01, undefined, 'Fraction of height over which ribs fade out at each rim')}
          </>
        )}
        {s.style === 'perforated' && (
          <>
            {f.sel('Pattern', (d) => d.shade, 'perfPattern', PATTERNS)}
            {f.num('Hole size', (d) => d.shade, 'perfSize', 2, 60, 0.5, 'mm')}
            {f.num('Web between holes', (d) => d.shade, 'perfSpacing', 1, 20, 0.5, 'mm')}
            {(s.perfPattern === 'slots' || s.perfPattern === 'diamonds') &&
              f.num(s.perfPattern === 'slots' ? 'Slot length factor' : 'Diamond aspect', (d) => d.shade, 'perfElongation', 1, 8, 0.1)}
            {f.num('Solid margin top/bottom', (d) => d.shade, 'perfMargin', 0, 60, 0.5, 'mm')}
            {s.perfPattern === 'voronoi' ? (
              f.num('Voronoi seed', (d) => d.shade, 'perfSeed', 0, 9999, 1)
            ) : (
              f.tog('Stagger alternate rows', (d) => d.shade, 'perfStagger')
            )}
          </>
        )}
        {s.style === 'textured' && <TextureEditor p={p} edit={edit} pick={(d) => d.shade.texture} />}
        {s.style === 'basket' && (
          <>
            {f.num('Strands per direction', (d) => d.shade, 'basketStrands', 4, 60, 1)}
            {f.num('Strand width', (d) => d.shade, 'basketStrandWidth', 1, 20, 0.5, 'mm')}
            {f.num('Strand thickness', (d) => d.shade, 'basketStrandThickness', 0.6, 6, 0.1, 'mm')}
            {f.num('Helix angle', (d) => d.shade, 'basketAngle', 15, 75, 1, '°', 'From horizontal')}
            {f.num('Solid rim bands', (d) => d.shade, 'basketRim', 0, 40, 0.5, 'mm')}
          </>
        )}
      </Collapsible>

      <Collapsible title="Vase mode" nested>
        {f.tog('Export shade as vase-mode solid', (d) => d.shade, 'vaseMode', 'Spiral-vase printing: smooth, corrugated ribs or textured only')}
        {s.vaseMode && f.num('Slicer line width', (d) => d.shade, 'vaseLineWidth', 0.3, 2, 0.05, 'mm', 'Used as the wall thickness in vase mode')}
        {s.vaseMode && !vaseCompatible(s) && (
          <Note>Vase mode is only meaningful for smooth, corrugated-rib or textured shades.</Note>
        )}
      </Collapsible>

      <Collapsible title="Diffuser" nested>
        {f.sel('Diffuser', (d) => d.shade.diffuser, 'position', DIFFUSER_POSITIONS)}
        {s.diffuser.position !== 'none' && (
          <>
            {f.num('Thickness', (d) => d.shade.diffuser, 'thickness', 0.4, 4, 0.1, 'mm', 'Disc and skirt wall: 0.8–1.6 mm (2–4 perimeters) diffuses evenly in translucent PETG / white PLA')}
            {f.num('Skirt height', (d) => d.shade.diffuser, 'skirtHeight', 2, 40, 0.5, 'mm', 'Sleeve inside the shade rim that holds the diffuser by friction')}
            {f.num('Fit clearance', (d) => d.shade.diffuser, 'clearance', 0, 1, 0.05, 'mm', 'Per side against the shade inner wall: ≈ 0.2 snug, 0.4 loose')}
            {f.num('Inset from rim', (d) => d.shade.diffuser, 'inset', 0, 100, 0.5, 'mm')}
            <Note>
              {s.diffuser.position === 'bottom'
                ? 'Annular disc around the cup, under the spider / fitter hub. It closes the bottom opening for UL 153 (closed-bottom spacing).'
                : 'Full disc across the top opening. It closes the top for UL 153 (closed-top spacing, more heat trapped).'}
            </Note>
          </>
        )}
      </Collapsible>
    </Collapsible>
  );
}
