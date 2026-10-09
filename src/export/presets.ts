import { deflateSync, inflateSync } from 'fflate';
import { BULB_SHAPES } from '../model/hardware';
import { DEFAULT_PARAMS, type LampParams } from '../model/params';

const VERSION = DEFAULT_PARAMS.version;

/** Closed string unions, validated during merge so a corrupt preset can't poison the geometry code. */
const ENUMS: Record<string, readonly string[]> = {
  'hardware.socketBase': ['E26', 'E12'],
  'hardware.socketMount': ['nipple', 'ring', 'snap'],
  'bulb.shape': BULB_SHAPES.map((b) => b.id),
  'bulb.tech': ['led', 'ledFilament', 'cfl', 'incandescent', 'halogen'],
  'base.section.kind': ['circle', 'polygon', 'superellipse'],
  'base.edgeStyle': ['fillet', 'chamfer'],
  'base.legKind': ['printed', 'dowel'],
  'base.dowelMaterial': ['wood', 'aluminum', 'steel'],
  'stem.section.kind': ['circle', 'polygon', 'superellipse'],
  'stem.baseJoint.kind': ['fused', 'spigot'],
  'stem.cupJoint.kind': ['fused', 'spigot'],
  'cup.section.kind': ['circle', 'polygon', 'superellipse'],
  'shade.bottomSection.kind': ['circle', 'polygon', 'superellipse'],
  'shade.topSection.kind': ['circle', 'polygon', 'superellipse'],
  'shade.sizing': ['absolute', 'clearance'],
  'shade.profile': ['linear', 'bulge', 'custom'],
  'shade.topClosure': ['open', 'closed', 'vented'],
  'shade.mount': ['spider', 'fitter', 'base', 'lip'],
  'shade.style': ['smooth', 'ribs', 'perforated', 'textured', 'basket'],
  'shade.texture.pattern': ['none', 'knit', 'knurl', 'ribs', 'checker'],
  'base.texture.pattern': ['none', 'knit', 'knurl', 'ribs', 'checker'],
  'shade.ribWave': ['sine', 'triangle', 'square', 'scallop'],
  'shade.perfPattern': ['circles', 'hexes', 'slots', 'diamonds', 'voronoi'],
  'materials.shade': ['PLA', 'PETG', 'ASA', 'ABS', 'PC'],
  'materials.structure': ['PLA', 'PETG', 'ASA', 'ABS', 'PC'],
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keep `incoming` when it matches the default's type; arrays replace wholesale; else keep the default. */
function mergeValue<T>(def: T, inc: unknown): T {
  if (Array.isArray(def)) return (Array.isArray(inc) ? inc : def) as T;
  switch (typeof def) {
    case 'number':
      return (typeof inc === 'number' && Number.isFinite(inc) ? inc : def) as T;
    case 'string':
      return (typeof inc === 'string' ? inc : def) as T;
    case 'boolean':
      return (typeof inc === 'boolean' ? inc : def) as T;
    case 'object':
      return (isPlainObject(inc) ? mergeParams(def as object, inc) : def) as T;
    default:
      return def;
  }
}

function mergeParams(def: object, inc: Record<string, unknown>): object {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(def)) {
    out[key] = mergeValue((def as Record<string, unknown>)[key], inc[key]);
  }
  return out;
}

/** Reject values that are strings but not legal members of their union. */
function enforceEnums(merged: Record<string, unknown>, def: Record<string, unknown>, path = ''): void {
  for (const key of Object.keys(def)) {
    const p = path ? `${path}.${key}` : key;
    const dv = def[key] as unknown;
    const mv = merged[key] as unknown;
    const allowed = ENUMS[p];
    if (allowed && typeof mv === 'string' && !allowed.includes(mv)) {
      merged[key] = dv;
    } else if (isPlainObject(dv) && isPlainObject(mv)) {
      enforceEnums(mv as Record<string, unknown>, dv as Record<string, unknown>, p);
    }
  }
}

/** Parse preset JSON (possibly partial) onto DEFAULT_PARAMS. Unknown keys are dropped. */
export function paramsFromJson(text: string): LampParams {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Preset is not valid JSON: ${(e as Error).message}`);
  }
  if (!isPlainObject(raw)) throw new Error('Preset must be a JSON object');
  if (raw.version !== undefined && raw.version !== VERSION) {
    throw new Error(`Preset version ${String(raw.version)} is not supported (expected ${VERSION})`);
  }
  const merged = mergeParams(DEFAULT_PARAMS, raw) as Record<string, unknown>;
  enforceEnums(merged, DEFAULT_PARAMS as unknown as Record<string, unknown>);
  return merged as unknown as LampParams;
}

/** Human-readable preset file contents. */
export function paramsToJson(p: LampParams): string {
  return JSON.stringify(p, null, 2);
}

/* ---- URL-safe compressed form: JSON → fflate deflate → base64url ---- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out.slice(0, out.indexOf('=') === -1 ? out.length : out.indexOf('=')).replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlToBytes(s: string): Uint8Array {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = clean.length % 4 === 0 ? '' : '='.repeat(4 - (clean.length % 4));
  const str = clean + pad;
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of str) {
    if (ch === '=') break;
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('invalid base64url character');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** Compressed, URL-safe string for the `#p=` hash. */
export function encodeParams(p: LampParams): string {
  const json = JSON.stringify(p);
  return bytesToBase64Url(deflateSync(new TextEncoder().encode(json)));
}

/** Inverse of {@link encodeParams}; deep-merges onto DEFAULT_PARAMS and validates the version. */
export function decodeParams(s: string): LampParams {
  let json: string;
  try {
    json = new TextDecoder().decode(inflateSync(base64UrlToBytes(s.trim())));
  } catch (e) {
    throw new Error(`Preset string could not be decoded: ${(e as Error).message}`);
  }
  return paramsFromJson(json);
}
