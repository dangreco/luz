import type { SafetyCheck } from '../safety/checks';

export type SafetyStatus = SafetyCheck['status'];

const ICONS: Record<SafetyStatus, string> = { pass: '✓', warn: '!', fail: '✕', info: 'i' };
const STATUS_LABEL: Record<SafetyStatus, string> = { pass: 'Pass', warn: 'Warning', fail: 'Fail', info: 'Info' };

/** Worst status among the checks (fail > warn > pass); info-only or empty lists are 'info'. */
export function overallStatus(checks: SafetyCheck[]): SafetyStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  if (checks.some((c) => c.status === 'pass')) return 'pass';
  return 'info';
}

export function SafetyBadge({ checks, busy }: { checks: SafetyCheck[]; busy: boolean }) {
  const status = overallStatus(checks);
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const text =
    checks.length === 0
      ? 'No checks yet'
      : fails > 0
        ? `${fails} failing`
        : warns > 0
          ? `${warns} warning${warns > 1 ? 's' : ''}`
          : 'All checks pass';
  return (
    <span className={`badge status-${status}${busy ? ' stale' : ''}`} title="Safety summary — an engineering aid, not a certification">
      <span className="icon">{ICONS[status]}</span>
      {text}
    </span>
  );
}

export function SafetyPanel({ checks }: { checks: SafetyCheck[] }) {
  // Failures first, then warnings, info, passes — stable within each status.
  const order: SafetyStatus[] = ['fail', 'warn', 'info', 'pass'];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return (
    <section className="panel-section">
      <h2>Safety checks</h2>
      <p className="note">
        Estimates against UL 153 / CSA C22.2 No. 12 construction rules. This tool never certifies a design — test and
        label the finished lamp as required.
      </p>
      {sorted.length === 0 && <p className="note">Waiting for the first build…</p>}
      <ul className="checks">
        {sorted.map((c) => (
          <li key={c.id} className={`check status-${c.status}`}>
            <span className="icon" title={STATUS_LABEL[c.status]} aria-label={STATUS_LABEL[c.status]}>
              {ICONS[c.status]}
            </span>
            <div className="check-body">
              <div className="check-title">{c.title}</div>
              <div className="check-detail">{c.detail}</div>
              {c.source && <div className="check-source">Source: {c.source}</div>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
