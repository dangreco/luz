import type { LampParams } from '../model/params';
import type { SafetyCheck } from '../safety/checks';
import type { LampView, WorkerRequest, WorkerResponse } from './messages';

export const DEBOUNCE_MS = 150;

export interface GeometryResult {
  /** the parameters this result was built from */
  params: LampParams;
  build: LampView;
  checks: SafetyCheck[];
  /** wall-clock ms from posting the request to receiving the result */
  ms: number;
}

export interface GeometryCallbacks {
  onResult(result: GeometryResult): void;
  onError(message: string): void;
  /** true while a request is debouncing, queued or running */
  onBusy(busy: boolean): void;
}

interface Job {
  id: number;
  params: LampParams;
}

/**
 * Debounced, single-flight client for the geometry worker. Only one build runs at a time; a response is
 * dropped if a newer request has been issued since it was posted (the newer one is posted right after).
 */
export class GeometryClient {
  private worker: Worker;
  private timer: number | undefined;
  private nextId = 0;
  private wanted: Job | null = null;
  private inflight: (Job & { t0: number }) | null = null;
  private disposed = false;

  constructor(private readonly cb: GeometryCallbacks) {
    this.worker = this.spawn();
  }

  request(params: LampParams): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.wanted = { id: ++this.nextId, params };
      this.pump();
      this.reportBusy();
    }, DEBOUNCE_MS);
    this.reportBusy();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.worker.terminate();
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      this.failed(e.message || 'Geometry worker crashed');
    };
    worker.onmessageerror = () => this.failed('Geometry worker sent an unreadable message');
    return worker;
  }

  private failed(message: string): void {
    if (this.disposed) return;
    this.worker.terminate();
    this.worker = this.spawn();
    this.inflight = null;
    this.cb.onError(message);
    this.pump();
    this.reportBusy();
  }

  private pump(): void {
    if (this.inflight || !this.wanted) return;
    const job = this.wanted;
    this.inflight = { ...job, t0: performance.now() };
    const req: WorkerRequest = { id: job.id, params: job.params };
    this.worker.postMessage(req);
  }

  private handle(msg: WorkerResponse): void {
    const job = this.inflight;
    if (this.disposed || !job || job.id !== msg.id) return;
    this.inflight = null;
    const stale = this.wanted !== null && this.wanted.id !== msg.id;
    if (this.wanted?.id === msg.id) this.wanted = null;
    if (!stale) {
      if ('error' in msg) this.cb.onError(msg.error);
      else this.cb.onResult({ params: job.params, build: msg.build, checks: msg.checks, ms: performance.now() - job.t0 });
    }
    this.pump();
    this.reportBusy();
  }

  private reportBusy(): void {
    this.cb.onBusy(this.timer !== undefined || this.inflight !== null);
  }
}
