/**
 * Payloads Gero signs for its own protocols, which no dApp or partner may get
 * signed. A CIP-30 signData from the stake key over
 * `gero-xdev/v1|DEVICE_REGISTER|…` is the wallet-control proof that registers a
 * device, and over `gero-support/v1|…` it logs into the user's support chat; a
 * site that obtained either through an ordinary sign-message prompt could use it
 * as the user.
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
] as const;

const GERO_SUBJECT = /^gero-[a-z0-9-]+\/v\d+(?:\||$)/;

export const RESERVED_SIGN_DATA_MESSAGE = 'Gero does not sign messages reserved for its own protocols';

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
