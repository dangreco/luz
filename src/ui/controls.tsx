import { useId, useState, type ReactNode } from 'react';

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange(value: number): void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  hint?: string;
}

/** Slider + numeric input. Typed values are clamped to [min, max] on blur; integer steps round. */
export function NumberField({ label, value, onChange, min, max, step, unit, hint }: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const integer = Number.isInteger(step);
  const commit = (v: number) => onChange(integer ? Math.round(v) : v);

  return (
    <div className="field num" title={hint}>
      <label htmlFor={id}>
        {label}
        {unit ? <span className="unit"> ({unit})</span> : null}
      </label>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamp(value, min, max)}
        onChange={(e) => commit(parseFloat(e.target.value))}
        aria-label={label}
      />
      <input
        id={id}
        className="numbox"
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(Math.round(value * 1e4) / 1e4)}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v) && v >= min && v <= max) commit(v);
        }}
        onBlur={() => {
          if (draft !== null) {
            const v = parseFloat(draft);
            if (Number.isFinite(v)) commit(clamp(v, min, max));
            setDraft(null);
          }
        }}
      />
    </div>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

export interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange(value: T): void;
  hint?: string;
}

export function SelectField<T extends string>({ label, value, options, onChange, hint }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div className="field select" title={hint}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const next = options.find((o) => o.value === e.target.value);
          if (next) onChange(next.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  hint?: string;
}

export function ToggleField({ label, checked, onChange, hint }: ToggleFieldProps) {
  const id = useId();
  return (
    <div className="field toggle" title={hint}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
}

export function TextField({ label, value, onChange }: TextFieldProps) {
  const id = useId();
  return (
    <div className="field select">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export interface CollapsibleProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** nested sections render with a lighter style */
  nested?: boolean;
}

/** Native <details> section: open state lives in the DOM so it survives parameter edits. */
export function Collapsible({ title, children, defaultOpen = false, nested = false }: CollapsibleProps) {
  return (
    <details className={nested ? 'group nested' : 'group'} open={defaultOpen}>
      <summary>{title}</summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className="subheading">{children}</h4>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}
