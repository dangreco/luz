import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type LampParams } from '../model/params';
import { decodeParams, encodeParams, paramsFromJson, paramsToJson } from './presets';

describe('paramsToJson / paramsFromJson', () => {
  it('round-trips the full default params', () => {
    expect(paramsFromJson(paramsToJson(DEFAULT_PARAMS))).toEqual(DEFAULT_PARAMS);
  });

  it('is pretty-printed', () => {
    const json = paramsToJson(DEFAULT_PARAMS);
    expect(json).toContain('\n  "version"');
    expect(json.split('\n').length).toBeGreaterThan(50);
  });

  it('deep-merges a partial preset onto DEFAULT_PARAMS', () => {
    const merged = paramsFromJson('{"version":1,"name":"Kitchen","bulb":{"watts":60,"markedWatts":75}}');
    expect(merged.name).toBe('Kitchen');
    expect(merged.bulb.watts).toBe(60);
    expect(merged.bulb.markedWatts).toBe(75);
    expect(merged.bulb.tech).toBe(DEFAULT_PARAMS.bulb.tech);
    expect(merged.shade).toEqual(DEFAULT_PARAMS.shade);
    expect(merged.hardware.socket.bodyDiameter).toBe(DEFAULT_PARAMS.hardware.socket.bodyDiameter);
  });

  it('replaces arrays wholesale', () => {
    const merged = paramsFromJson('{"shade":{"customProfile":[2,1.5,1,1,1.5,2]}}');
    expect(merged.shade.customProfile).toEqual([2, 1.5, 1, 1, 1.5, 2]);
    // a non-array value is ignored, not merged
    const kept = paramsFromJson('{"shade":{"customProfile":42}}');
    expect(kept.shade.customProfile).toEqual(DEFAULT_PARAMS.shade.customProfile);
  });

  it('drops unknown keys and ignores wrong-typed values', () => {
    const merged = paramsFromJson(
      '{"version":1,"name":"A","bogus":123,"bulb":{"watts":"60","tech":123,"nope":true},"shade":{"wallThickness":null}}',
    ) as unknown as Record<string, unknown>;
    expect('bogus' in merged).toBe(false);
    expect((merged.bulb as Record<string, unknown>).nope).toBeUndefined();
    const lamp = merged as unknown as LampParams;
    expect(lamp.bulb.watts).toBe(DEFAULT_PARAMS.bulb.watts);
    expect(lamp.bulb.tech).toBe(DEFAULT_PARAMS.bulb.tech);
    expect(lamp.shade.wallThickness).toBe(DEFAULT_PARAMS.shade.wallThickness);
  });

  it('rejects invalid enum strings', () => {
    const merged = paramsFromJson('{"hardware":{"socketBase":"E39"},"shade":{"style":"woven","topClosure":"half"}}');
    expect(merged.hardware.socketBase).toBe('E26');
    expect(merged.shade.style).toBe('ribs');
    expect(merged.shade.topClosure).toBe('open');
  });

  it('rejects unsupported versions and non-objects', () => {
    expect(() => paramsFromJson('{"version":2}')).toThrow(/version 2/);
    expect(() => paramsFromJson('[]')).toThrow(/JSON object/);
    expect(() => paramsFromJson('{oops')).toThrow(/not valid JSON/);
  });
});

describe('encodeParams / decodeParams', () => {
  it('round-trips modified params', () => {
    const p = structuredClone(DEFAULT_PARAMS);
    p.name = 'Studio 42';
    p.bulb.tech = 'incandescent';
    p.bulb.markedWatts = 150;
    p.shade.style = 'basket';
    p.shade.basketAngle = 60;
    p.materials.shade = 'PC';
    p.quality.ringsPer10mm = 8;
    const decoded = decodeParams(encodeParams(p));
    expect(decoded).toEqual(p);
  });

  it('produces URL-safe characters only and is much smaller than the JSON', () => {
    const s = encodeParams(DEFAULT_PARAMS);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeLessThan(JSON.stringify(DEFAULT_PARAMS).length * 0.75);
  });

  it('decodes a partial (old-share-link) payload with defaults filled in', () => {
    const json = JSON.stringify({ version: 1, name: 'Old', bulb: { watts: 40 } });
    const hash = encodeParams(JSON.parse(json) as unknown as LampParams);
    const decoded = decodeParams(hash);
    expect(decoded.name).toBe('Old');
    expect(decoded.bulb.watts).toBe(40);
    expect(decoded.base).toEqual(DEFAULT_PARAMS.base);
  });

  it('throws on garbage', () => {
    expect(() => decodeParams('')).toThrow();
    expect(() => decodeParams('!!!not-base64!!!')).toThrow();
    const notDeflated = btoa('hello world').replace(/\+/g, '-').replace(/\//g, '_');
    expect(() => decodeParams(notDeflated)).toThrow();
  });
});
