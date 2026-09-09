/** Network selection is mandatory: ledger 8 and 9 sign different envelopes. */
export function midnightLedgerVersion(network: string): 8 | 9 {
  switch (network.toLowerCase()) {
    case 'mainnet':
    case 'preprod': return 8;
    case 'stagenet': return 9;
    default: throw new Error(`Unsupported Midnight network: ${network}`);
  }
}

export function requireMidnightLedger8(network: string, operation: string): void {
  if (midnightLedgerVersion(network) !== 8) {
    throw new Error(`${operation} is not supported on Midnight Stagenet (ledger 9)`);
  }
}

/** Keep tagged ledger 9 values internal; the public REST/storage contract is hex. */
export function schnorrHex(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'tag' in value && 'value' in value
    && value.tag === 'schnorr' && typeof value.value === 'string') return value.value;
  throw new Error('Expected a Midnight Schnorr key or signature');
}

export async function midnightKeystore(secret: Uint8Array, network: string) {
  if (midnightLedgerVersion(network) === 9) {
    const { createKeystore } = await import('midnight-v9-unshielded-wallet');
    return createKeystore({ kind: 'schnorr', secret }, 'stagenet');
  }
  const { createKeystore } = await import('@midnightntwrk/wallet-sdk-unshielded-wallet');
  return createKeystore(secret, network.toLowerCase());
}

export interface MidnightSigningSegment {
  index: number;
  role: 'NightExternal' | 'Zswap';
  dataHex: string;
}

/**
 * The background segment route is used for native NIGHT DUST registration.
 * Unshielded sends sign the complete fee-balanced transaction separately;
 * Nexus's per-input transfer indexes are not intent IDs and never enter here.
 * Validate every supplied payload before asking for any signatures.
 */
export async function validateMidnightSigningSegments(
  network: string,
  unprovenTxHex: string | undefined,
  segments: MidnightSigningSegment[],
): Promise<void> {
  const version = midnightLedgerVersion(network);
  // Existing ledger-8 callers may omit the envelope. Ledger 9 must never do so.
  if (!unprovenTxHex) {
    if (version === 9) throw new Error('Ledger 9 signing requires the unproven transaction');
    return;
  }
  const raw = strictMidnightHex(unprovenTxHex);
  const tx = await (async () => {
    if (version === 9) {
      const ledger = await import('@midnightntwrk/ledger-v9');
      const decoded: import('@midnightntwrk/ledger-v9').UnprovenTransaction = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', raw);
      ledger.Transaction.fromParts(network.toLowerCase()).merge(decoded);
      return decoded;
    }
    const ledger = await import('@midnight-ntwrk/ledger-v8');
    const decoded: import('@midnight-ntwrk/ledger-v8').UnprovenTransaction = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', raw);
    ledger.Transaction.fromParts(network.toLowerCase()).merge(decoded);
    return decoded;
  })();
  if (new Set(segments.map(segment => segment.index)).size !== segments.length) {
    throw new Error('Duplicate Midnight signing segment');
  }
  if (version === 9 && (segments.length !== 1 || segments[0].index !== 1
    || !tx.intents?.get(1)?.dustActions?.registrations.length)) {
    throw new Error('Ledger 9 segment signing requires one native DUST registration payload');
  }
  for (const segment of segments) {
    const intent = tx.intents?.get(segment.index);
    if (!intent || segment.role !== 'NightExternal') throw new Error('Invalid Midnight signing segment');
    const canonical = intent.signatureData(segment.index);
    const supplied = strictMidnightHex(segment.dataHex);
    if (canonical.length !== supplied.length || canonical.some((byte, index) => byte !== supplied[index])) {
      throw new Error(`Segment ${segment.index}: signing payload does not match this network's transaction`);
    }
  }
}

export function strictMidnightHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length === 0 || clean.length % 2 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('Invalid Midnight transaction hex');
  }
  return Uint8Array.from(Buffer.from(clean, 'hex'));
}
