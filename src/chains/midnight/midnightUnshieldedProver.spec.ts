// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ledger8 from '@midnight-ntwrk/ledger-v8';
import * as ledger9 from '@midnightntwrk/ledger-v9';
import { proveUnshieldedTransfer } from './midnightUnshieldedProver';
import { midnightProofServerCommand } from './midnightConfig';

afterEach(() => vi.unstubAllGlobals());

describe('real ledger-specific proving envelope', () => {
  it.each(['mainnet', 'preprod', 'stagenet'])('uses real prove/bind and preserves the %s empty envelope', async network => {
    const runtime = network === 'stagenet' ? ledger9 : ledger8;
    const tx = runtime.Transaction.fromParts(network);
    const signedTxHex = Buffer.from(tx.serialize()).toString('hex');
    // Empty envelopes need no circuit HTTP call. This verifies SDK markers,
    // network selection and binding, not the correctness of a funded proof.
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { provenTxHex } = await proveUnshieldedTransfer({ sdkNetworkId: network, signedTxHex, proving: { url: 'http://localhost:6300' } });
    const decoded = network === 'stagenet'
      ? ledger9.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(provenTxHex, 'hex'))
      : ledger8.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(provenTxHex, 'hex'));
    expect(Buffer.from(decoded.eraseProofs().serialize()).toString('hex')).toBe(Buffer.from(tx.eraseProofs().serialize()).toString('hex'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a valid legacy envelope supplied as Stagenet before contacting the prover', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const signedTxHex = Buffer.from(ledger8.Transaction.fromParts('preprod').serialize()).toString('hex');
    await expect(proveUnshieldedTransfer({ sdkNetworkId: 'stagenet', signedTxHex, proving: { url: 'http://localhost:6300' } })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('infers the embedded network for cross-device payloads independently of the paired Cardano wallet', async () => {
    const signedTxHex = Buffer.from(ledger9.Transaction.fromParts('stagenet').serialize()).toString('hex');
    const result = await proveUnshieldedTransfer({ signedTxHex, proving: { url: 'http://localhost:6300' } });
    expect(() => ledger9.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(result.provenTxHex, 'hex'))).not.toThrow();
  });

  it('shows the matching circuit server and binds its port to loopback', () => {
    expect(midnightProofServerCommand('Stagenet')).toContain('proof-server:9.0.0-rc.6');
    expect(midnightProofServerCommand('Preprod')).toContain('proof-server:8.1.0');
    expect(midnightProofServerCommand('Stagenet')).toContain('127.0.0.1:6300:6300');
  });
});
