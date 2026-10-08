import { useRef, useState } from 'react';
import type { PartMesh } from '../geometry/build';
import { to3mf } from '../export/threemf';
import { stlZip } from '../export/zip';
import { decodeParams, encodeParams, paramsFromJson, paramsToJson } from '../export/presets';
import { MATERIALS } from '../model/hardware';
import type { LampParams } from '../model/params';
import { PART_COLORS } from '../viewer/partColors';

function download(bytes: Uint8Array | string, filename: string, mime: string): void {
  const blob = new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function fileSafe(name: string): string {
  return name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'lamp';
}

function size(part: PartMesh): string {
  const [a, b, c] = part.bbox.max.map((v, i) => v - part.bbox.min[i]);
  return `${a.toFixed(1)} × ${b.toFixed(1)} × ${c.toFixed(1)} mm`;
}

/** Print-orientation size: flipping about X keeps X/Y/Z extents, so only the direction text differs. */
function orientation(part: PartMesh): string {
  return part.printFlip ? 'Flipped 180° about X (prints upside-down in this preview orientation)' : 'As shown (assembled orientation)';
}

export interface PartsPanelProps {
  params: LampParams;
  parts: PartMesh[];
  onReplace(next: LampParams): void;
}

export function PartsPanel({ params, parts, onReplace }: PartsPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const base = fileSafe(params.name);
  const totalMass = parts.reduce((sum, part) => sum + part.mass, 0);

  const run = (label: string, action: () => void | Promise<void>) => {
    Promise.resolve()
      .then(action)
      .then(() => setMessage(label ? { kind: 'ok', text: label } : null))
      .catch((err: unknown) => setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) }));
  };

  return (
    <section className="panel-section">
      <h2>Parts</h2>
      {parts.length === 0 && <p className="note">No geometry yet.</p>}
      <ul className="parts">
        {parts.map((part) => (
          <li key={part.id} className="part">
            <div className="part-head">
              <span className="swatch" style={{ background: `#${PART_COLORS[part.id].toString(16).padStart(6, '0')}` }} />
              <strong>{part.label}</strong>
              <span className="part-mass">{part.mass.toFixed(1)} g</span>
            </div>
            <dl>
              <dt>Material</dt>
              <dd>{MATERIALS[part.material].label}</dd>
              <dt>Size</dt>
              <dd>{size(part)}</dd>
              <dt>Orientation</dt>
              <dd>{orientation(part)}</dd>
            </dl>
            {part.notes.length > 0 && (
              <ul className="part-notes">
                {part.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {parts.length > 0 && <p className="note">Total printed mass ≈ {totalMass.toFixed(1)} g (solid model; slicer infill will differ).</p>}

      <h2>Export</h2>
      <div className="button-grid">
        <button type="button" disabled={parts.length === 0} onClick={() => run('STL zip downloaded', () => download(stlZip(parts, base), `${base}-stl.zip`, 'application/zip'))}>
          STL (zip)
        </button>
        <button type="button" disabled={parts.length === 0} onClick={() => run('3MF downloaded', () => download(to3mf(parts), `${base}.3mf`, 'model/3mf'))}>
          3MF
        </button>
        <button type="button" onClick={() => run('Preset saved', () => download(paramsToJson(params), `${base}.luz.json`, 'application/json'))}>
          Save preset JSON
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Load preset JSON
        </button>
        <button
          type="button"
          onClick={() =>
            run('Share link copied', async () => {
              const encoded = encodeParams(params);
              // Round-trip first so a link that cannot be read back is never handed out.
              decodeParams(encoded);
              history.replaceState(null, '', `#p=${encoded}`);
              await navigator.clipboard.writeText(location.href);
            })
          }
        >
          Copy share link
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          run(`Loaded ${file.name}`, async () => onReplace(paramsFromJson(await file.text())));
        }}
      />
      {message && <p className={`message ${message.kind}`}>{message.text}</p>}
    </section>
  );
}
