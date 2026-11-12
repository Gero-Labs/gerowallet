import { describe, expect, it, vi } from 'vitest';
import * as ledger8 from '@midnight-ntwrk/ledger-v8';
import * as ledger9 from '@midnightntwrk/ledger-v9';
import { assertLocalProverPayload, createLocalProverServingOptions, localProverProfile } from './localProverProfile';
import { PROOF_SERVER_DOCKER_TAG, PROOF_SERVER_DOCKER_TAG_LEDGER9 } from '@/chains/midnight/midnightConfig';

const legacy = ledger8.Transaction.fromParts('preprod').serialize();
const ledger9Tx = (network: string) => ledger9.Transaction.fromParts(network).serialize();

describe('local prover profile by ledger', () => {
  it('reads ledger9 (and its earlier name, stagenet); anything else is the ledger 8 profile', () => {
    expect(localProverProfile(undefined)).toBe('legacy');
    expect(localProverProfile('invalid')).toBe('legacy');
    expect(localProverProfile('stagenet')).toBe('ledger9');
    expect(localProverProfile('ledger9')).toBe('ledger9');
  });

  it.each(['mainnet', 'preprod', 'preview', 'stagenet'])('the ledger 9 profile serves %s ledger 9 bytes', async (network) => {
    await expect(assertLocalProverPayload(ledger9Tx(network), 'ledger9')).resolves.toBeUndefined();
    await expect(assertLocalProverPayload(ledger9Tx(network), 'legacy')).rejects.toThrow('selected local prover profile');
  });

  it('validates actual ledger bytes with the real SDK', async () => {
    await expect(assertLocalProverPayload(legacy, 'legacy')).resolves.toBeUndefined();
    await expect(assertLocalProverPayload(legacy, 'ledger9')).rejects.toThrow('selected local prover profile');
    await expect(assertLocalProverPayload(new Uint8Array([1, 2, 3]), 'ledger9')).rejects.toThrow('selected local prover profile');
  });

  it('keeps advertised, accepted and decoded versions aligned when rebuilding serving options', async () => {
    const prove = vi.fn(async () => new Uint8Array([1]));
    let advertised = true;
    const deps = {
      isAdvertised: () => advertised,
      isServingEnabled: (id: string) => id === 'paired-phone',
      checkProverHealth: vi.fn(async () => true),
      prove,
    };
    const before = createLocalProverServingOptions('legacy', deps);
    const after = createLocalProverServingOptions('ledger9', deps);
    expect(before.getProver()?.proverLedgerVersion).toBe(PROOF_SERVER_DOCKER_TAG);
    expect(after.getProver()?.proverLedgerVersion).toBe(PROOF_SERVER_DOCKER_TAG_LEDGER9);
    expect(PROOF_SERVER_DOCKER_TAG_LEDGER9).toBe('9.0.0');
    expect(after.serving.ledgerVersion).toBe(after.getProver()?.proverLedgerVersion);
    expect(after.serving.isServingEnabled('stranger')).toBe(false);
    await expect(after.serving.prove(legacy)).rejects.toThrow('selected local prover profile');
    expect(prove).not.toHaveBeenCalled();
    await expect(after.serving.prove(ledger9Tx('preprod'))).resolves.toEqual(new Uint8Array([1]));
    expect(prove).toHaveBeenCalledOnce();
    await expect(before.serving.prove(ledger9Tx('preprod'))).rejects.toThrow(); // old service never adopts new bytes
    advertised = false;
    expect(after.getProver()).toBeUndefined();
  });
});
