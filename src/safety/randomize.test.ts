import { beforeAll, describe, expect, it } from 'vitest';
import { buildLamp } from '../geometry/build';
import { loadManifold, type ManifoldToplevel } from '../geometry/wasm';
import { SOCKET_PRESETS } from '../model/hardware';
import { DEFAULT_PARAMS, type LampParams } from '../model/params';
import { runChecks } from './checks';
import { searchDesign } from './randomize';

describe('searchDesign', () => {
  let m: ManifoldToplevel;
  beforeAll(async () => {
    m = await loadManifold();
  });

  const e12: LampParams = structuredClone(DEFAULT_PARAMS);
  e12.hardware.socketBase = 'E12';
  e12.hardware.socket = { ...SOCKET_PRESETS.E12 };
  e12.bulb = { ...e12.bulb, shape: 'B11', watts: 4, markedWatts: 25 };

  it('returns designs that pass every safety check at full quality and keep the user hardware', () => {
    for (const [current, seed] of [
      [DEFAULT_PARAMS, 11],
      [DEFAULT_PARAMS, 4],
      [e12, 6],
    ] as const) {
      const { params } = searchDesign(m, current, seed);
      expect(params.hardware).toEqual(current.hardware);
      expect(params.bulb).toEqual(current.bulb);
      const failing = runChecks(params, buildLamp(m, params)).filter((c) => c.status === 'fail');
      expect(failing.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    }
  }, 60000);
});
