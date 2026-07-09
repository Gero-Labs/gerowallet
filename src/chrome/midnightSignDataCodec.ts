// Shared strict decoder for the Midnight DApp Connector's signData payload.
// Used by BOTH the mini-gero side panel's approval UI (DAppOverlay.vue, to
// render a preview of the ACTUAL bytes that will be signed) and the
// background signing handler (background.ts's SIGN_MIDNIGHT_CONNECTOR_DATA)
// — a single source of truth so the two can never disagree on what a given
// (data, encoding) pair decodes to.
//
// Security rationale: Node/Buffer's hex/base64 decoders are LENIENT —
// `Buffer.from('aabbZZZZlongdeceptivetext', 'hex')` silently truncates at the
// first invalid character instead of throwing, and base64 silently skips
// invalid characters. If the popup displayed the raw un-decoded wire string
// while signing used a silently-truncated decode, a malicious dapp could show
// the user a long, plausible-looking string while only a short, attacker-
// chosen byte prefix actually gets cryptographically signed — completely
// decoupling what the user approves from what they sign. Strict validation
// (reject on any invalid character, don't silently drop anything) closes that
// gap; both call sites reject identically instead of degrading gracefully.

export type MidnightSignDataEncoding = 'hex' | 'base64' | 'text';

const STRICT_HEX = /^[0-9a-fA-F]*$/;
// RFC 4648 base64 alphabet, with correct '=' padding only at the end (0-2 pad
// chars), grouped in 4-char blocks — rejects stray padding, wrong length, and
// out-of-alphabet characters that Buffer.from would otherwise silently skip.
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Decode a dapp-supplied signData payload strictly — throws on any malformed
 * input rather than silently truncating/skipping invalid characters.
 */
export function decodeSignDataPayload(
  data: string,
  encoding: MidnightSignDataEncoding,
): Uint8Array {
  if (encoding === 'text') {
    return new Uint8Array(Buffer.from(data, 'utf-8'));
  }
  if (encoding === 'hex') {
    const bare = data.startsWith('0x') ? data.slice(2) : data;
    if (bare.length % 2 !== 0 || !STRICT_HEX.test(bare)) {
      throw new Error('signData: malformed hex payload (non-hex characters or odd length)');
    }
    return new Uint8Array(Buffer.from(bare, 'hex'));
  }
  if (encoding === 'base64') {
    if (!STRICT_BASE64.test(data)) {
      throw new Error('signData: malformed base64 payload (invalid characters or padding)');
    }
    return new Uint8Array(Buffer.from(data, 'base64'));
  }
  throw new Error(`signData: unsupported encoding "${encoding}"`);
}

/** Hex string of the decoded bytes, for display in the approval popup. */
export function decodedPayloadHexPreview(data: string, encoding: MidnightSignDataEncoding): string {
  return Buffer.from(decodeSignDataPayload(data, encoding)).toString('hex');
}
