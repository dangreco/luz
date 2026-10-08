import type { ReactElement } from 'react';
import type { LampParams } from '../model/params';
import { NumberField, SelectField, TextField, ToggleField, type Option } from './controls';
import type { Edit } from './types';

/**
 * Field builders bound to the current params. Each field is addressed by a picker that returns the owning
 * object of a LampParams tree (so it works on both the live params and the draft being mutated) plus a key:
 *
 *   f.num('Size', (d) => d.base, 'size', 60, 400, 1, 'mm')
 */
export interface Fields {
  num<K extends string>(
    label: string,
    pick: (d: LampParams) => Record<NoInfer<K>, number>,
    key: K,
    min: number,
    max: number,
    step: number,
    unit?: string,
    hint?: string,
  ): ReactElement;
  sel<K extends string, V extends string>(
    label: string,
    pick: (d: LampParams) => Record<NoInfer<K>, V>,
    key: K,
    options: ReadonlyArray<Option<V>>,
    hint?: string,
  ): ReactElement;
  tog<K extends string>(
    label: string,
    pick: (d: LampParams) => Record<NoInfer<K>, boolean>,
    key: K,
    hint?: string,
  ): ReactElement;
  text<K extends string>(label: string, pick: (d: LampParams) => Record<NoInfer<K>, string>, key: K): ReactElement;
}

export function makeFields(p: LampParams, edit: Edit): Fields {
  return {
    num: (label, pick, key, min, max, step, unit, hint) => (
      <NumberField
        label={label}
        value={pick(p)[key]}
        min={min}
        max={max}
        step={step}
        unit={unit}
        hint={hint}
        onChange={(v) =>
          edit((d) => {
            pick(d)[key] = v;
          })
        }
      />
    ),
    sel: (label, pick, key, options, hint) => (
      <SelectField
        label={label}
        value={pick(p)[key]}
        options={options}
        hint={hint}
        onChange={(v) =>
          edit((d) => {
            pick(d)[key] = v;
          })
        }
      />
    ),
    tog: (label, pick, key, hint) => (
      <ToggleField
        label={label}
        checked={pick(p)[key]}
        hint={hint}
        onChange={(v) =>
          edit((d) => {
            pick(d)[key] = v;
          })
        }
      />
    ),
    text: (label, pick, key) => (
      <TextField
        label={label}
        value={pick(p)[key]}
        onChange={(v) =>
          edit((d) => {
            pick(d)[key] = v;
          })
        }
      />
    ),
  };
}
