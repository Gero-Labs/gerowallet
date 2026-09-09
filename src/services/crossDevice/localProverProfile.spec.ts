import { describe, expect, it, vi } from 'vitest';
import * as ledger8 from '@midnight-ntwrk/ledger-v8';
import * as ledger9 from '@midnightntwrk/ledger-v9';
import { assertLocalProverPayload, createLocalProverServingOptions, localProverProfile } from './localProverProfile';

const legacy = ledger8.Transaction.fromParts('preprod').serialize();
const stagenet = ledger9.Transaction.fromParts('stagenet').serialize();

describe('explicit local prover profile', () => {
  it('preserves legacy configuration unless Stagenet is explicitly selected', () => {
    expect(localProverProfile(undefined)).toBe('legacy');
    expect(localProverProfile('invalid')).toBe('legacy');
    expect(localProverProfile('stagenet')).toBe('stagenet');
  });

  it('validates actual ledger bytes and embedded network with the real SDK', async () => {
    await expect(assertLocalProverPayload(legacy, 'legacy')).resolves.toBeUndefined();
    await expect(assertLocalProverPayload(stagenet, 'stagenet')).resolves.toBeUndefined();
    await expect(assertLocalProverPayload(stagenet, 'legacy')).rejects.toThrow('selected local prover profile');
    await expect(assertLocalProverPayload(legacy, 'stagenet')).rejects.toThrow('selected local prover profile');
    await expect(assertLocalProverPayload(ledger9.Transaction.fromParts('mainnet').serialize(), 'stagenet')).rejects.toThrow('selected local prover profile');
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
    const after = createLocalProverServingOptions('stagenet', deps);
    expect(before.getProver()?.proverLedgerVersion).toBe('8.1.0');
    expect(after.getProver()?.proverLedgerVersion).toBe('9.0.0-rc.6');
    expect(after.serving.ledgerVersion).toBe(after.getProver()?.proverLedgerVersion);
    expect(after.serving.isServingEnabled('stranger')).toBe(false);
    await expect(after.serving.prove(legacy)).rejects.toThrow('selected local prover profile');
    expect(prove).not.toHaveBeenCalled();
    await expect(after.serving.prove(stagenet)).resolves.toEqual(new Uint8Array([1]));
    expect(prove).toHaveBeenCalledOnce();
    await expect(before.serving.prove(stagenet)).rejects.toThrow(); // old service never adopts new bytes
    advertised = false;
    expect(after.getProver()).toBeUndefined();
  });
});
