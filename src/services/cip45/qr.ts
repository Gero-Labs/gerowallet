export const CIP45_QR_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Accepts either the CIP-45 QR payload "<peerId>:peerjs:<timestamp>"
 * (DAppPeerConnect.generateQRCode format) or a bare peer id pasted from the
 * dApp UI. Throws Error('invalid') or Error('stale').
 */
export function parseCip45Input(input: string, now: number = Date.now()): { dappPeerId: string } {
  const trimmed = (input ?? '').trim();
  if (!trimmed) throw new Error('invalid');

  if (!trimmed.includes(':')) {
    return { dappPeerId: trimmed };
  }

  const parts = trimmed.split(':');
  if (parts.length !== 3 || parts[1] !== 'peerjs' || !parts[0]) throw new Error('invalid');

  const timestamp = Number(parts[2]);
  if (!Number.isFinite(timestamp)) throw new Error('invalid');
  if (now - timestamp > CIP45_QR_MAX_AGE_MS) throw new Error('stale');

  return { dappPeerId: parts[0] };
}
