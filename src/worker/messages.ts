import type { LampBuild } from '../geometry/build';
import type { Layout } from '../model/layout';
import type { LampParams } from '../model/params';
import type { SafetyCheck } from '../safety/checks';
import type { SearchResult } from '../safety/randomize';

export type WorkerRequest =
  | { id: number; kind: 'build'; params: LampParams }
  /** search for a random design that builds and passes every safety check, for `params`' hardware */
  | { id: number; kind: 'randomize'; params: LampParams; seed: number };

/**
 * A `LampBuild` as it crosses the worker boundary. `Layout.shade` holds closures (not structured-cloneable),
 * so it is dropped; everything else in the layout is plain data.
 */
export type LampView = Omit<LampBuild, 'layout'> & { layout: Omit<Layout, 'shade'> };

export type WorkerResponse =
  | { id: number; build: LampView; checks: SafetyCheck[] }
  | { id: number; random: SearchResult }
  | { id: number; error: string };
