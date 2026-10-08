import { buildLamp } from '../geometry/build';
import { loadManifold } from '../geometry/wasm';
import { runChecks } from '../safety/checks';
import { searchDesign } from '../safety/randomize';
import type { LampView, WorkerRequest, WorkerResponse } from './messages';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function respond(msg: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, { transfer });
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const { id, params } = req;
  try {
    const manifold = await loadManifold();
    if (req.kind === 'randomize') {
      respond({ id, random: searchDesign(manifold, params, req.seed) });
      return;
    }
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
