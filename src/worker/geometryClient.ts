import type { LampParams } from '../model/params';
import type { SafetyCheck } from '../safety/checks';
import type { SearchResult } from '../safety/randomize';
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
  private searcher: Worker | null = null;
  private cancelSearch: ((err: Error) => void) | null = null;

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
    this.searcher?.terminate();
  }

  /**
   * Search for a random safe design for `params`' hardware in a separate worker, so live builds stay
   * responsive. A new call cancels the previous search (its promise rejects).
   */
  randomize(params: LampParams, seed: number): Promise<SearchResult> {
    this.searcher?.terminate();
    this.cancelSearch?.(new Error('Superseded by a newer randomize request'));
    const worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
    this.searcher = worker;
    return new Promise<SearchResult>((resolve, reject) => {
      this.cancelSearch = reject;
      const done = () => {
        worker.terminate();
        if (this.searcher === worker) {
          this.searcher = null;
          this.cancelSearch = null;
        }
      };
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        done();
        if ('random' in e.data) resolve(e.data.random);
        else reject(new Error('error' in e.data ? e.data.error : 'Unexpected worker response'));
      };
      worker.onerror = (e) => {
        e.preventDefault();
        done();
        reject(new Error(e.message || 'Randomize worker crashed'));
      };
      const req: WorkerRequest = { id: 0, kind: 'randomize', params, seed };
      worker.postMessage(req);
    });
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
    const req: WorkerRequest = { id: job.id, kind: 'build', params: job.params };
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
      else if ('build' in msg) this.cb.onResult({ params: job.params, build: msg.build, checks: msg.checks, ms: performance.now() - job.t0 });
    }
    this.pump();
    this.reportBusy();
  }

  private reportBusy(): void {
    this.cb.onBusy(this.timer !== undefined || this.inflight !== null);
  }
}
