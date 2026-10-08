import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeParams, paramsFromJson, paramsToJson } from '../export/presets';
import { DEFAULT_PARAMS, type LampParams } from '../model/params';
import type { Edit } from './types';

const STORAGE_KEY = 'luz.params.v1';
const HASH_PREFIX = '#p=';
const HISTORY_LIMIT = 200;
/** Edits closer together than this (slider drags, typing) collapse into one undo step. */
const COALESCE_MS = 500;

interface History {
  past: LampParams[];
  present: LampParams;
  future: LampParams[];
}

/** Share-link hash first, then the last session's params, then the defaults. */
function loadInitial(): { params: LampParams; error: string | null } {
  if (location.hash.startsWith(HASH_PREFIX)) {
    try {
      return { params: decodeParams(location.hash.slice(HASH_PREFIX.length)), error: null };
    } catch (err) {
      return {
        params: structuredClone(DEFAULT_PARAMS),
        error: `Could not read the share link: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null) {
    try {
      return { params: paramsFromJson(saved), error: null };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return { params: structuredClone(DEFAULT_PARAMS), error: null };
}

export interface ParamHistory {
  params: LampParams;
  edit: Edit;
  /** replace all params (preset, loaded file) as one undo step */
  replace(next: LampParams): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  /** problem reading the initial share link, if any */
  loadError: string | null;
}

export function useParamHistory(): ParamHistory {
  const [initial] = useState(loadInitial);
  const [history, setHistory] = useState<History>({ past: [], present: initial.params, future: [] });
  // The ref mirrors `history` so edits compute from the latest value outside React's updater functions.
  const ref = useRef(history);
  const lastEdit = useRef(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, paramsToJson(history.present));
  }, [history.present]);

  const set = useCallback((next: History) => {
    ref.current = next;
    setHistory(next);
  }, []);

  const push = useCallback(
    (next: LampParams, coalesce: boolean) => {
      const h = ref.current;
      const now = performance.now();
      const merge = coalesce && h.past.length > 0 && now - lastEdit.current < COALESCE_MS;
      lastEdit.current = coalesce ? now : 0;
      set({
        past: merge ? h.past : [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present],
        present: next,
        future: [],
      });
    },
    [set],
  );

  const edit = useCallback<Edit>(
    (mutate) => {
      const draft = structuredClone(ref.current.present);
      mutate(draft);
      push(draft, true);
    },
    [push],
  );

  const replace = useCallback((next: LampParams) => push(next, false), [push]);

  const undo = useCallback(() => {
    const h = ref.current;
    if (h.past.length === 0) return;
    lastEdit.current = 0;
    set({ past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] });
  }, [set]);

  const redo = useCallback(() => {
    const h = ref.current;
    if (h.future.length === 0) return;
    lastEdit.current = 0;
    set({ past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) });
  }, [set]);

  return {
    params: history.present,
    edit,
    replace,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    loadError: initial.error,
  };
}
