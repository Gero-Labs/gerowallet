import { bech32 } from 'bech32';

/**
 * CIP-105 / CIP-129 DRep identifier handling.
 *
 * Three forms are live at once and are discriminated ONLY by decoded payload
 * length — no version byte, no checksum difference:
 *
 *   drep1…        28 bytes  legacy CIP-105 bare credential (gov.tools URLs)
 *   drep1…        29 bytes  CIP-129: 1 header byte + 28-byte credential
 *   drep_vkh1…    28 bytes  CIP-105 with the credential type in the HRP
 *   drep_script1… 28 bytes  ditto, script credential
 *   <56 hex>      28 bytes  raw credential, as the CIP-30/95 spec passes it
 *
 * CIP-129 header nibbles: high = key type (DRep = 0010), low = credential type
 * (key hash = 0010, script hash = 0011). So 0x22 = DRep key hash, 0x23 = DRep
 * script hash.
 *
 * ALWAYS match on `credentialHex`. Matching on the display string means a user
 * pastes a legitimate id in the other form and gets "not found".
 *
 * Note there is no network tag by design (CIP-105 models this on pool IDs), so
 * the same DRep id is byte-identical on preprod and mainnet — the UI must carry
 * network context itself.
 */

const DREP_KEY_HASH_HEADER = 0x22;
const DREP_SCRIPT_HASH_HEADER = 0x23;
const CREDENTIAL_BYTES = 28;

/** The two hardcoded predefined DReps. They are not credentials and must not be decoded. */
export const KEYWORD_DREPS = ['drep_always_abstain', 'drep_always_no_confidence'] as const;

export type DRepCredentialType = 'keyHash' | 'scriptHash';
export type DRepIdForm = 'cip129' | 'cip105' | 'hex' | 'keyword';

export interface ParsedDRepId {
  /** 56-char lowercase hex of the 28-byte credential — the ONLY safe match key. */
  credentialHex: string;
  credentialType: DRepCredentialType;
  /** Which of the live string forms the input was written in. */
  form: DRepIdForm;
}

function toHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/**
 * Parse any live DRep identifier form. Returns null for anything unrecognised —
 * never throws, because this runs on user-pasted text.
 */
export function parseDRepId(input: string | null | undefined): ParsedDRepId | null {
  if (!input) return null;
  const value = String(input).trim();
  if (!value) return null;

  if ((KEYWORD_DREPS as readonly string[]).includes(value)) {
    return { credentialHex: value, credentialType: 'keyHash', form: 'keyword' };
  }

  // Raw credential hex (CIP-30/95 passes key hashes this way).
  if (/^[0-9a-fA-F]{56}$/.test(value)) {
    return { credentialHex: value.toLowerCase(), credentialType: 'keyHash', form: 'hex' };
  }

  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(value, 200);
  } catch {
    return null;
  }

  const bytes = bech32.fromWords(decoded.words);

  if (decoded.prefix === 'drep_vkh') {
    if (bytes.length !== CREDENTIAL_BYTES) return null;
    return { credentialHex: toHex(bytes), credentialType: 'keyHash', form: 'cip105' };
  }

  if (decoded.prefix === 'drep_script') {
    if (bytes.length !== CREDENTIAL_BYTES) return null;
    return { credentialHex: toHex(bytes), credentialType: 'scriptHash', form: 'cip105' };
  }

  if (decoded.prefix === 'drep') {
    // 29 bytes → CIP-129 (header + credential). 28 bytes → legacy bare credential.
    if (bytes.length === CREDENTIAL_BYTES + 1) {
      const header = bytes[0];
      if (header !== DREP_KEY_HASH_HEADER && header !== DREP_SCRIPT_HASH_HEADER) return null;
      return {
        credentialHex: toHex(bytes.slice(1)),
        credentialType: header === DREP_SCRIPT_HASH_HEADER ? 'scriptHash' : 'keyHash',
        form: 'cip129',
      };
    }
    if (bytes.length === CREDENTIAL_BYTES) {
      return { credentialHex: toHex(bytes), credentialType: 'keyHash', form: 'cip105' };
    }
    return null;
  }

  return null;
}

/** Boolean convenience wrapper. */
export function isDRepId(input: string | null | undefined): boolean {
  return parseDRepId(input) !== null;
}

/**
 * True when both inputs denote the same DRep, in whatever form each is written.
 * False if either side is unparseable — never throws.
 *
 * `credentialType` is deliberately NOT compared, and it is worth saying why
 * because the omission reads like an oversight.
 *
 * Raw 56-character hex carries no type byte, so `parseDRepId` has to assume one
 * and assumes `keyHash` (see the CIP-30/95 branch above). Bare hex is exactly
 * how the votes feed and the dApp connector hand credentials over. Requiring the
 * types to match would therefore make a SCRIPT DRep — a DAO or a multisig, which
 * do exist — compare false against its own bech32 form, and this predicate
 * decides "is this my DRep" and "is this vote mine" across the whole governance
 * surface. That false negative is the damaging direction.
 *
 * What comparing types would buy is safety against two DIFFERENT DReps sharing
 * 28 credential bytes across a key hash and a script hash, which needs a
 * blake2b-224 collision. Trading a real, reachable false negative against an
 * infeasible false positive is the wrong way round.
 */
export function sameDRep(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = parseDRepId(a);
  const right = parseDRepId(b);
  if (!left || !right) return false;
  return left.credentialHex === right.credentialHex;
}

/** Encode a 28-byte credential as a CIP-129 `drep1…` identifier. */
export function toCip129(credentialHex: string, credentialType: DRepCredentialType = 'keyHash'): string | null {
  if (!/^[0-9a-fA-F]{56}$/.test(credentialHex)) return null;
  const header = credentialType === 'scriptHash' ? DREP_SCRIPT_HASH_HEADER : DREP_KEY_HASH_HEADER;
  const bytes = [header, ...fromHex(credentialHex.toLowerCase())];
  return bech32.encode('drep', bech32.toWords(bytes), 200);
}
