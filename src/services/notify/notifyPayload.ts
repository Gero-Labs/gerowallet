// Push notifications — payload parsing (pure). CONTRACT.md §6.1, §6.3, §6.5, §6.7.
//
// A push is never dropped: parsing returns what is usable and a reason for the
// rest, and notifyRender.ts degrades from there. Only the shape is checked here;
// `t`, `c` and `d` are open enums (§2.3) and stay strings.

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from './notifyAuth';
import { NOTIFY_PROTOCOL } from './notifyTypes';

/**
 * One received native asset. `sym` is the server's §6.5 symbol (the on-chain name when it is a plain
 * ticker). `unit` (policy id + asset name, hex) marks `qty` as raw base units for the renderer to
 * name and scale from the wallet's registry data; without a unit, `qty` is already display-ready.
 */
export interface PushAsset {
  sym?: string;
  qty: string;
  unit?: string;
}

export interface PushAmounts {
  ada?: string;
  assets: PushAsset[];
  otherAssets?: number;
}

export interface PushDetails {
  tx?: string;
  epoch?: number;
  deviceId?: string;
  orderRef?: string;
  proposalRef?: string;
  drepId?: string;
}

export interface PushPayload {
  v: number;
  t: string;
  c: string;
  w: string;
  e: string;
  ts: number;
  exp: number;
  d: string;
  n?: number;
  a?: PushAmounts;
  x?: PushDetails;
}

export type ParsedPush =
  | { ok: true; payload: PushPayload }
  /** Rule 2: bad JSON, no object, `v` not an integer or above ours. Render the generic notification. */
  | { ok: false; reason: 'bad_json' | 'bad_version'; partial: Partial<PushPayload> };

const HEX32 = /^[0-9a-f]{32}$/;
const SYM = /^[A-Z0-9]{1,10}$/; // §6.5, re-checked by the client (rule 7)
const UNIT = /^[0-9a-f]{56,120}$/; // policy id + asset name, hex
const QTY = /^[0-9]+(\.[0-9]+)?$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** One well-formed asset (rule 7: a symbol that fails the pattern drops the asset; a unit must be hex). */
function sanitizeAsset(x: unknown): PushAsset | undefined {
  if (!isObject(x)) return undefined;
  const sym = str(x['sym']);
  const unit = str(x['unit']);
  const qty = str(x['qty']);
  if (qty === undefined || !QTY.test(qty)) return undefined;
  if ((sym === undefined && unit === undefined) || (sym !== undefined && !SYM.test(sym)) || (unit !== undefined && !UNIT.test(unit))) return undefined;
  return { ...(sym !== undefined ? { sym } : {}), qty, ...(unit !== undefined ? { unit } : {}) };
}

/** Keep only well-formed amounts; drop any asset whose symbol fails the pattern (rule 7). */
export function sanitizeAmounts(raw: unknown): PushAmounts | undefined {
  if (!isObject(raw)) return undefined;
  const ada = str(raw['ada']);
  const assets = Array.isArray(raw['assets']) ? raw['assets'].map(sanitizeAsset).filter((x): x is PushAsset => x !== undefined) : [];
  const other = raw['otherAssets'];
  const out: PushAmounts = { assets };
  if (ada !== undefined && /^[0-9]+(\.[0-9]{1,6})?$/.test(ada)) out.ada = ada;
  if (isInt(other) && other > 0) out.otherAssets = other;
  return out.ada === undefined && !out.assets.length && !out.otherAssets ? undefined : out;
}

function sanitizeDetails(raw: unknown): PushDetails | undefined {
  if (!isObject(raw)) return undefined;
  const out: PushDetails = {};
  const tx = str(raw['tx']); if (tx && /^[0-9a-f]{64}$/.test(tx)) out.tx = tx;
  if (isInt(raw['epoch']) && (raw['epoch'] as number) >= 0) out.epoch = raw['epoch'] as number;
  const deviceId = str(raw['deviceId']); if (deviceId && HEX32.test(deviceId)) out.deviceId = deviceId;
  const orderRef = str(raw['orderRef']); if (orderRef && /^[0-9a-f]{64}#[0-9]+$/.test(orderRef)) out.orderRef = orderRef;
  const proposalRef = str(raw['proposalRef']); if (proposalRef && proposalRef.length <= 128) out.proposalRef = proposalRef;
  const drepId = str(raw['drepId']); if (drepId && /^drep1[a-z0-9]{6,}$/.test(drepId)) out.drepId = drepId;
  return Object.keys(out).length ? out : undefined;
}

/** Parse the plaintext of a push (`PushMessageData.text()`), or an already-parsed object. */
export function parsePushPayload(input: string | unknown): ParsedPush {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try { raw = JSON.parse(input); } catch { return { ok: false, reason: 'bad_json', partial: {} }; }
  }
  if (!isObject(raw)) return { ok: false, reason: 'bad_json', partial: {} };
  const partial: Partial<PushPayload> = { w: str(raw['w']), e: str(raw['e']), d: str(raw['d']), t: str(raw['t']), c: str(raw['c']) };
  if (!isInt(raw['v']) || raw['v'] > NOTIFY_PROTOCOL) return { ok: false, reason: 'bad_version', partial };
  const w = str(raw['w']) ?? '';
  const e = str(raw['e']);
  return {
    ok: true,
    payload: {
      v: raw['v'],
      t: str(raw['t']) ?? '',
      c: str(raw['c']) ?? '',
      w,
      // A malformed tag still needs a collapse key: derive a stable one from the raw bytes.
      e: e && HEX32.test(e) ? e : bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(raw)))).slice(0, 32),
      ts: isInt(raw['ts']) ? raw['ts'] : 0,
      exp: isInt(raw['exp']) ? raw['exp'] : Number.MAX_SAFE_INTEGER,
      d: str(raw['d']) ?? 'home',
      ...(isInt(raw['n']) && raw['n'] >= 0 ? { n: raw['n'] } : {}),
      ...(sanitizeAmounts(raw['a']) ? { a: sanitizeAmounts(raw['a']) } : {}),
      ...(sanitizeDetails(raw['x']) ? { x: sanitizeDetails(raw['x']) } : {}),
    },
  };
}

/** §6.3: `e = hex(HMAC-SHA256(eventKey, eventId))[0:32]`, the same on both clients and the server. */
export function computeEventTag(eventKeyHex: string, eventId: string): string {
  return bytesToHex(hmac(sha256, hexToBytes(eventKeyHex), new TextEncoder().encode(eventId))).slice(0, 32);
}
