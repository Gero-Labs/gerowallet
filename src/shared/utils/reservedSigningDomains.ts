/**
 * Payloads Gero signs for its own protocols, which no dApp or partner may get
 * signed. A CIP-30 signData from the stake key over
 * `gero-xdev/v1|DEVICE_REGISTER|…` is the wallet-control proof that registers a
 * device, and over `gero-support/v1|…` it logs into the user's support chat; a
 * site that obtained either through an ordinary sign-message prompt could use it
 * as the user. `gero-signing/v1|…` is how Gero's root keys approve the keys that
 * sign its server answers.
 *
 * Every Gero subject has the shape `gero-<name>/v<N>` followed by `|` or the end,
 * so the pattern covers subjects added later; the list names the current ones
 * (reservedSigningDomains.spec.ts checks it against the code that builds them).
 */

export const RESERVED_SIGNING_DOMAINS = [
  'gero-xdev/',
  'gero-xdev-pair/',
  'gero-xprove/',
  'gero-notify/',
  'gero-support/',
  // Root approvals of Gero's response-signing keys (signedResponseRoots.ts).
  'gero-signing/',
] as const;

const GERO_SUBJECT = /^gero-[a-z0-9-]+\/v\d+(?:\||$)/;

export const RESERVED_SIGN_DATA_MESSAGE = 'Gero does not sign messages reserved for its own protocols';
export const INVALID_SIGN_DATA_PAYLOAD_MESSAGE = 'The message to sign must be hex-encoded bytes';

/** Whether a sign-message payload is plain hex bytes: pairs of hex digits and nothing else. */
export function isHexPayload(payload: unknown): payload is string {
  return typeof payload === 'string' && /^(?:[0-9a-fA-F]{2})*$/.test(payload);
}

/**
 * Why a dApp's sign-message payload must be refused, or null to let it through.
 *
 * A payload that is not plain hex is refused first. The signers decode hex leniently
 * (`Buffer.from(x, 'hex')` drops an odd last digit and stops at the first non-hex
 * character, and a byte array passes through), so `hex(reserved text) + "0"` would
 * get past the reserved-domain check below and still sign the reserved bytes.
 */
export function signDataRefusal(payload: unknown): 'invalid' | 'reserved' | null {
  if (!isHexPayload(payload)) return 'invalid';
  return reservedSigningDomain(payload) ? 'reserved' : null;
}

function hexToText(hex: string): string | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * The reserved prefix a sign-message payload starts with, or null. Checks the
 * payload both as given and hex-decoded to UTF-8 (CIP-30 payloads are hex).
 */
export function reservedSigningDomain(payload: unknown): string | null {
  if (typeof payload !== 'string' || payload.length === 0) return null;
  const decoded = hexToText(payload.startsWith('0x') ? payload.slice(2) : payload);
  for (const text of decoded === null ? [payload] : [payload, decoded]) {
    const lower = text.toLowerCase();
    const listed = RESERVED_SIGNING_DOMAINS.find(prefix => lower.startsWith(prefix));
    if (listed) return listed;
    const subject = GERO_SUBJECT.exec(lower);
    if (subject) return subject[0].replace(/\|$/, '');
  }
  return null;
}
