import type { LampParams, TextureParams, TexturePattern } from '../model/params';
import type { Option } from './controls';
import { makeFields } from './fields';
import type { Edit } from './types';

const PATTERNS: Array<Option<TexturePattern>> = [
  { value: 'none', label: 'None' },
  { value: 'knit', label: 'Knit (staggered bumps)' },
  { value: 'knurl', label: 'Knurl (diamond mesh)' },
  { value: 'ribs', label: 'Ribs / rope (twist)' },
  { value: 'checker', label: 'Checker weave / linen' },
];

export interface TextureEditorProps {
  p: LampParams;
  edit: Edit;
  /** owning texture in a params tree (live or draft) */
  pick: (d: LampParams) => TextureParams;
}

/** Pattern + density + depth + twist controls for any surface texture (shade, base). */
export function TextureEditor({ p, edit, pick }: TextureEditorProps) {
  const f = makeFields(p, edit);
  const t = pick(p);
  return (
    <>
      {f.sel('Texture', pick, 'pattern', PATTERNS)}
      {t.pattern !== 'none' && (
        <>
          {f.num('Columns (around)', pick, 'columns', 2, 240, 1)}
          {t.pattern !== 'ribs' && f.num('Rows (along height)', pick, 'rows', 1, 300, 1)}
          {f.num('Relief depth', pick, 'depth', 0.1, 6, 0.05, 'mm', 'Outward only — never reduces bulb clearance')}
          {f.num('Pattern twist', pick, 'twist', -720, 720, 1, '°', 'Helical twist of the pattern over the textured height')}
        </>
      )}
    </>
  );
}
