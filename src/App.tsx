import { useEffect, useRef, useState } from 'react';
import { PartsPanel } from './ui/PartsPanel';
import { ParamPanel } from './ui/ParamPanel';
import { SafetyBadge, SafetyPanel } from './ui/SafetyPanel';
import { ViewerPane } from './ui/ViewerPane';
import { useParamHistory } from './ui/useParamHistory';
import { DEFAULT_PARAMS } from './model/params';
import { GeometryClient, type GeometryResult } from './worker/geometryClient';

export function App() {
  const { params, edit, replace, undo, redo, canUndo, canRedo, loadError } = useParamHistory();
  const [result, setResult] = useState<GeometryResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [buildError, setBuildError] = useState<string | null>(null);
  const client = useRef<GeometryClient | null>(null);

  useEffect(() => {
    const c = new GeometryClient({
      onResult: (r) => {
        setBuildError(null);
        setResult(r);
      },
      onError: setBuildError,
      onBusy: setBusy,
    });
    client.current = c;
    return () => {
      c.dispose();
      client.current = null;
    };
  }, []);

  useEffect(() => {
    client.current?.request(params);
  }, [params]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target;
      // Let text inputs keep their native undo.
      if (t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'number')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const reset = () => replace(structuredClone(DEFAULT_PARAMS));
  const issues = result?.build.layout.issues ?? [];

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          Luz <span className="tagline">parametric table-lamp generator</span>
        </h1>
        <span className="lamp-name">{params.name}</span>
        <div className="header-actions">
          <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
            ↷ Redo
          </button>
          <button type="button" onClick={reset} title="Reset all parameters to the defaults">
            Reset to defaults
          </button>
          <SafetyBadge checks={result?.checks ?? []} busy={busy} />
        </div>
      </header>
      {loadError && <div className="banner error">{loadError}</div>}
      <main className="app-main">
        <aside className="left-panel">
          <ParamPanel p={params} edit={edit} onReplace={replace} onReset={reset} />
        </aside>
        <section className="center-panel">
          <ViewerPane
            build={result?.build ?? null}
            params={result?.params ?? null}
            busy={busy}
            buildMs={result?.ms ?? null}
            error={buildError}
          />
        </section>
        <aside className="right-panel">
          {issues.length > 0 && (
            <section className="panel-section">
              <h2>Layout issues</h2>
              <ul className="issues">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </section>
          )}
          <SafetyPanel checks={result?.checks ?? []} />
          <PartsPanel params={params} parts={result?.build.parts ?? []} onReplace={replace} />
        </aside>
      </main>
    </div>
  );
}
