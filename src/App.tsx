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
  const [randomizing, setRandomizing] = useState(false);
  const [randomNote, setRandomNote] = useState<string | null>(null);

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
  const randomize = () => {
    const c = client.current;
    if (!c || randomizing) return;
    setRandomizing(true);
    setRandomNote(null);
    c.randomize(params, Math.floor(Math.random() * 2 ** 32))
      .then((r) => {
        replace(r.params);
        setRandomNote(
          `Found in ${r.tries} ${r.tries === 1 ? 'try' : 'tries'}${r.warnings.length ? ` — warnings: ${r.warnings.join(', ')}` : ', no warnings'}.`,
        );
      })
      .catch((err: Error) => {
        if (!err.message.startsWith('Superseded')) setRandomNote(err.message);
      })
      .finally(() => setRandomizing(false));
  };
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
          <button
            type="button"
            onClick={randomize}
            disabled={randomizing}
            title="Random form for your socket, bulb and materials — every candidate is built and must pass all safety checks (warnings allowed)"
          >
            {randomizing ? 'Randomizing…' : 'Randomize'}
          </button>
          <button type="button" onClick={reset} title="Reset all parameters to the defaults">
            Reset to defaults
          </button>
          <SafetyBadge checks={result?.checks ?? []} busy={busy} />
        </div>
      </header>
      {loadError && <div className="banner error">{loadError}</div>}
      {randomNote && <div className="banner info">{randomNote}</div>}
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
