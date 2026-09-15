import { bech32 } from 'bech32';

/**
 * Governance-action identifier handling.
 *
 * A governance action is identified by the transaction that proposed it plus
 * the index of the proposal within that transaction. Three forms circulate:
 *
 *   <64 hex>#<index>   cardano-cli and gov.tools URLs — the canonical display form
 *   gov_action1…       CIP-129 bech32: 32-byte tx hash + 1 trailing index byte
 *   <64 hex>%23<index> the same as the first, percent-encoded from a URL
 *
 * Nexus's REST API takes `{txHash}#{index}` in a path segment with the `#`
 * percent-encoded as `%23` — that is what toApiGovActionId() produces.
 */

const TX_HASH_BYTES = 32;

export interface GovActionId {
  /** 64-char lowercase hex transaction hash. */
  txHash: string;
  /** Zero-based index of the proposal within that transaction. */
  index: number;
}

function toHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Parse any live governance-action id form. Returns null for anything
 * unrecognised — never throws, because this runs on user-pasted text and on
 * router params.
 */
export function parseGovActionId(input: string | null | undefined): GovActionId | null {
  if (!input) return null;
  let value = String(input).trim();
  if (!value) return null;

  // A URL-sourced id arrives with the separator percent-encoded.
  value = value.replace(/%23/gi, '#');

  if (value.includes('#')) {
    const [hash, idx, ...rest] = value.split('#');
    if (rest.length > 0) return null;
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) return null;
    if (!/^\d+$/.test(idx)) return null;
    const index = Number(idx);
    if (!Number.isSafeInteger(index) || index < 0) return null;
    return { txHash: hash.toLowerCase(), index };
  }

  if (value.startsWith('gov_action')) {
    let decoded: { prefix: string; words: number[] };
    try {
      decoded = bech32.decode(value, 200);
    } catch {
      return null;
    }
    if (decoded.prefix !== 'gov_action') return null;
    const bytes = bech32.fromWords(decoded.words);
    if (bytes.length !== TX_HASH_BYTES + 1) return null;
    return { txHash: toHex(bytes.slice(0, TX_HASH_BYTES)), index: bytes[TX_HASH_BYTES] };
  }

  return null;
}

/** The form Nexus's path segment expects: `#` percent-encoded as `%23`. */
export function toApiGovActionId(id: GovActionId): string {
  return `${id.txHash}%23${id.index}`;
}

/** The canonical human/cli form. */
export function toDisplayGovActionId(id: GovActionId): string {
  return `${id.txHash}#${id.index}`;
}
