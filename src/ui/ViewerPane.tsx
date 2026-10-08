import { useEffect, useRef, useState } from 'react';
import type { PartId } from '../geometry/build';
import type { LampParams } from '../model/params';
import { DEFAULT_VIEW_OPTIONS, LampViewer, type ViewOptions } from '../viewer/LampViewer';
import { PART_COLORS } from '../viewer/partColors';
import type { LampView } from '../worker/messages';

type BoolOption = Exclude<keyof ViewOptions, 'visible'>;

const TOGGLES: Array<{ key: BoolOption; label: string; title: string }> = [
  { key: 'exploded', label: 'Exploded', title: 'Offset the parts along Z' },
  { key: 'sectionCut', label: 'Section cut', title: 'Clip the model with a plane through the lamp axis' },
  { key: 'shadeTranslucent', label: 'Translucent shade', title: 'Show the bulb through the shade' },
  { key: 'showHardware', label: 'Socket & bulb', title: 'Socket, shade ring and glowing bulb' },
  { key: 'showUl', label: 'UL spacing', title: 'UL 153 lamp centerline and minimum-spacing envelope (assumes open/open shade)' },
];

export interface ViewerPaneProps {
  build: LampView | null;
  /** the parameters `build` was generated from */
  params: LampParams | null;
  busy: boolean;
  buildMs: number | null;
  error: string | null;
}

export function ViewerPane({ build, params, busy, buildMs, error }: ViewerPaneProps) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<LampViewer | null>(null);
  const [options, setOptions] = useState<ViewOptions>(DEFAULT_VIEW_OPTIONS);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [glError, setGlError] = useState<string | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    try {
      const v = new LampViewer(el);
      v.setOptions(optionsRef.current);
      viewer.current = v;
    } catch (err) {
      setGlError(err instanceof Error ? err.message : String(err));
      return;
    }
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    viewer.current?.setBuild(build, params);
    viewer.current?.setOptions(optionsRef.current);
  }, [build, params]);

  useEffect(() => {
    viewer.current?.setOptions(options);
  }, [options]);

  const shownParts = build ? build.parts.map((p) => p.id) : [];

  return (
    <div className="viewer-pane">
      <div className="viewer-toolbar">
        {TOGGLES.map((t) => (
          <label key={t.key} className="chip" title={t.title}>
            <input
              type="checkbox"
              checked={options[t.key]}
              onChange={(e) => setOptions((o) => ({ ...o, [t.key]: e.target.checked }))}
            />
            {t.label}
          </label>
        ))}
        <span className="toolbar-sep" />
        {shownParts.map((id: PartId) => (
          <label key={id} className="chip" title={`Show / hide ${id}`}>
            <input
              type="checkbox"
              checked={options.visible[id]}
              onChange={(e) => setOptions((o) => ({ ...o, visible: { ...o.visible, [id]: e.target.checked } }))}
            />
            <span className="swatch" style={{ background: `#${PART_COLORS[id].toString(16).padStart(6, '0')}` }} />
            {id}
          </label>
        ))}
        <button type="button" className="chip-button" onClick={() => viewer.current?.resetView()}>
          Reset view
        </button>
      </div>
      <div className="viewer-canvas-host" ref={container} />
      <div className="viewer-status">
        {busy ? <span className="spinner" /> : null}
        <span>{busy ? 'Building…' : buildMs !== null ? `Built in ${buildMs.toFixed(0)} ms` : 'Waiting for geometry…'}</span>
      </div>
      {error && <div className="viewer-error">Build failed: {error}</div>}
      {glError && <div className="viewer-error">WebGL unavailable: {glError}</div>}
    </div>
  );
}
