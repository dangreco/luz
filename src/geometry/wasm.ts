import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

let instance: Promise<ManifoldToplevel> | null = null;

/**
 * Lazily initialise the Manifold WASM module once per realm (main thread, worker, or vitest).
 * In the browser the Vite-resolved URL is used; under Node (vitest) the module locates its own file.
 */
export function loadManifold(): Promise<ManifoldToplevel> {
  if (!instance) {
    // Node (vitest) has no `window`; the module then locates its own .wasm file.
    const isNode = typeof window === 'undefined' && typeof self === 'undefined';
    instance = Module(isNode ? undefined : { locateFile: () => wasmUrl }).then((m) => {
      m.setup();
      return m;
    });
  }
  return instance;
}

export type { ManifoldToplevel, Manifold, CrossSection, Mesh } from 'manifold-3d';
