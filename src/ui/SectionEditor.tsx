import { useMemo } from 'react';
import type { SectionParams, ShapeKind } from '../model/params';
import { sectionRadius } from '../model/section';
import { NumberField, SelectField, SubHeading, type Option } from './controls';

const KINDS: Array<Option<ShapeKind>> = [
  { value: 'circle', label: 'Circle' },
  { value: 'polygon', label: 'Polygon' },
  { value: 'superellipse', label: 'Superellipse' },
];

const SAMPLES = 120;
const VIEW = 100;
const HALF = VIEW / 2;

/** Closed SVG path of the section (circumscribed diameter 1 fits ~88 % of the box), plus its scale. */
function sectionPath(section: SectionParams): { d: string; refRadius: number } {
  const radii: number[] = [];
  let maxR = 0.5;
  for (let i = 0; i < SAMPLES; i++) {
    const r = sectionRadius(section, (i / SAMPLES) * Math.PI * 2);
    radii.push(r);
    maxR = Math.max(maxR, r);
  }
  const scale = (HALF * 0.88) / maxR;
  const pts = radii.map((r, i) => {
    const phi = (i / SAMPLES) * Math.PI * 2;
    return `${(HALF + r * Math.cos(phi) * scale).toFixed(2)},${(HALF - r * Math.sin(phi) * scale).toFixed(2)}`;
  });
  return { d: `M${pts.join('L')}Z`, refRadius: 0.5 * scale };
}

export interface SectionEditorProps {
  label: string;
  section: SectionParams;
  onChange(next: SectionParams): void;
}

export function SectionEditor({ label, section, onChange }: SectionEditorProps) {
  const { kind, sides, cornerRadius, exponent, aspect, rotation } = section;
  const { d, refRadius } = useMemo(
    () => sectionPath({ kind, sides, cornerRadius, exponent, aspect, rotation }),
    [kind, sides, cornerRadius, exponent, aspect, rotation],
  );

  return (
    <div className="section-editor">
      <SubHeading>{label}</SubHeading>
      <div className="section-editor-body">
        <div className="section-editor-fields">
          <SelectField label="Shape" value={kind} options={KINDS} onChange={(v) => onChange({ ...section, kind: v })} />
          {kind === 'polygon' && (
            <>
              <NumberField label="Sides" value={sides} min={3} max={12} step={1} onChange={(v) => onChange({ ...section, sides: v })} />
              <NumberField
                label="Corner rounding"
                value={cornerRadius}
                min={0}
                max={1}
                step={0.01}
                hint="0 = sharp corners, 1 = fully round (inscribed circle)"
                onChange={(v) => onChange({ ...section, cornerRadius: v })}
              />
            </>
          )}
          {kind === 'superellipse' && (
            <NumberField
              label="Exponent"
              value={exponent}
              min={1.2}
              max={8}
              step={0.05}
              hint="2 = ellipse, 4 = squircle"
              onChange={(v) => onChange({ ...section, exponent: v })}
            />
          )}
          <NumberField
            label="Aspect (Y / X)"
            value={aspect}
            min={0.3}
            max={3}
            step={0.01}
            onChange={(v) => onChange({ ...section, aspect: v })}
          />
          <NumberField
            label="Rotation"
            value={rotation}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={(v) => onChange({ ...section, rotation: v })}
          />
        </div>
        <svg className="section-preview" viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label={`${label} preview`}>
          <line x1={0} y1={HALF} x2={VIEW} y2={HALF} className="axis" />
          <line x1={HALF} y1={0} x2={HALF} y2={VIEW} className="axis" />
          <circle cx={HALF} cy={HALF} r={refRadius} className="ref" />
          <path d={d} className="shape" />
        </svg>
      </div>
    </div>
  );
}
