import { buildLamp } from '../geometry/build';
import { loadManifold } from '../geometry/wasm';
import { runChecks } from '../safety/checks';
import type { LampView, WorkerRequest, WorkerResponse } from './messages';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function respond(msg: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, { transfer });
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, params } = e.data;
  try {
    const manifold = await loadManifold();
    const full = buildLamp(manifold, params);
    const checks = runChecks(params, full);
    const { shade: _shade, ...layout } = full.layout;
    const build: LampView = { layout, parts: full.parts };
    const transfer = new Set<ArrayBuffer>();
    for (const part of build.parts) {
      for (const buf of [part.mesh.positions.buffer, part.mesh.indices.buffer]) {
        if (buf instanceof ArrayBuffer) transfer.add(buf);
      }
    }
    respond({ id, build, checks }, [...transfer]);
  } catch (err) {
    respond({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
