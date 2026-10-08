import type { LampBuild } from '../geometry/build';
import type { Layout } from '../model/layout';
import type { LampParams } from '../model/params';
import type { SafetyCheck } from '../safety/checks';

export interface WorkerRequest {
  id: number;
  params: LampParams;
}

/**
 * A `LampBuild` as it crosses the worker boundary. `Layout.shade` holds closures (not structured-cloneable),
 * so it is dropped; everything else in the layout is plain data.
 */
export type LampView = Omit<LampBuild, 'layout'> & { layout: Omit<Layout, 'shade'> };

export type WorkerResponse =
  | { id: number; build: LampView; checks: SafetyCheck[] }
  | { id: number; error: string };
