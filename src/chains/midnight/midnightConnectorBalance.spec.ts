// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import {
  connectorBalancePrompt,
  countWalletOwnedInputs,
  decodeUnboundTransaction,
  isSealedMidnightTransaction,
  summarizeContributions,
  summarizeForeignPayments,
  unshieldedAddressCodec,
  validateConnectorBalanceRequest,
} from './midnightConnectorBalance';
import type { UnboundTransaction } from './midnightConnectorBalance';

const NIGHT = '0'.repeat(64);
const OWNER = '00'.repeat(32);

/**
 * Circuit-free transactions never reach the prover, so a provider that
 * refuses everything proves the fixtures below are proof-free. (`mockProve()`
 * is NOT usable here: it returns a BOUND transaction, not `PreBinding`.)
 */
const noProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected /check'); },
  prove: async () => { throw new Error('unexpected /prove'); },
};

async function unboundEnvelope(network = 'preprod'): Promise<UnboundTransaction> {
  return ledger.Transaction.fromParts(network).prove(noProver, ledger.CostModel.initialCostModel()) as Promise<UnboundTransaction>;
}

/** A proven, unbound preprod tx whose only intent pays `night` out with no inputs. */
async function txNeeding(night: bigint): Promise<UnboundTransaction> {
  const intent = ledger.Intent.new(new Date(Date.now() + 60_000));
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], [{ value: night, owner: OWNER, type: NIGHT }], []);
  const unproven = ledger.Transaction.fromParts('preprod', undefined, undefined, intent);
  return unproven.prove(noProver, ledger.CostModel.initialCostModel()) as Promise<UnboundTransaction>;
}

describe('validateConnectorBalanceRequest', () => {
  it('accepts hex with payFees unset or true on a ledger-8 network', () => {
    expect(validateConnectorBalanceRequest({ tx: 'abcd' }, 'Preprod')).toEqual({ ok: true, tx: 'abcd', payFees: true });
    expect(validateConnectorBalanceRequest({ tx: 'abcd', options: { payFees: true } }, 'Mainnet')).toMatchObject({ ok: true });
  });

  it('rejects fee delegation, Stagenet, bad hex, oversized input and non-objects', () => {
    expect(validateConnectorBalanceRequest({ tx: 'abcd', options: { payFees: false } }, 'Preprod'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/payFees:false/) });
    expect(validateConnectorBalanceRequest({ tx: 'abcd' }, 'Stagenet'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/Stagenet/) });
    expect(validateConnectorBalanceRequest({ tx: 'xyz' }, 'Preprod'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/hex/) });
    expect(validateConnectorBalanceRequest({ tx: 'ab'.repeat(2 * 1024 * 1024 + 1) }, 'Preprod'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/large/) });
    expect(validateConnectorBalanceRequest({ tx: '' }, 'Preprod')).toMatchObject({ ok: false });
    expect(validateConnectorBalanceRequest(null, 'Preprod')).toMatchObject({ ok: false });
    expect(validateConnectorBalanceRequest({ tx: 'abcd' }, 'Preview')).toMatchObject({ ok: false, reason: expect.stringMatching(/Unsupported/) });
  });
});

describe('summarizeContributions', () => {
  it('lists what the wallet must supply per colour', async () => {
    expect(summarizeContributions(await txNeeding(5_000_000n))).toEqual([{ token: NIGHT, amount: '5000000' }]);
  });

  it('is empty for a balanced envelope', async () => {
    expect(summarizeContributions(await unboundEnvelope())).toEqual([]);
  });
});

describe('decodeUnboundTransaction', () => {
  it('round-trips a preprod tx and rejects it under another network', async () => {
    const hex = Buffer.from((await txNeeding(1n)).serialize()).toString('hex');
    expect(summarizeContributions(await decodeUnboundTransaction(hex, 'preprod'))).toEqual([{ token: NIGHT, amount: '1' }]);
    await expect(decodeUnboundTransaction(hex, 'mainnet')).rejects.toThrow();
  });

  it('rejects a sealed transaction (wrong binding marker)', async () => {
    const sealed = Buffer.from((await unboundEnvelope()).bind().serialize()).toString('hex');
    await expect(decodeUnboundTransaction(sealed, 'preprod')).rejects.toThrow();
  });
});

describe('the dapp transaction’s own inputs and payments', () => {
  // Synthetic keys, sampled per run — never hold funds.
  const walletKey = ledger.signatureVerifyingKey(ledger.sampleSigningKey());
  const otherKey = ledger.signatureVerifyingKey(ledger.sampleSigningKey());
  const WALLET = ledger.addressFromKey(walletKey);
  const OTHER = ledger.addressFromKey(otherKey);
  const spend = (owner: string, value: bigint) =>
    ({ value, owner, type: NIGHT, intentHash: ledger.sampleIntentHash(), outputNo: 0 });

  /** A proven, unbound preprod tx with one unshielded offer. */
  async function txWith(
    inputs: ReturnType<typeof spend>[],
    outputs: Array<{ value: bigint; owner: string; type: string }>,
    fallible = false,
  ): Promise<UnboundTransaction> {
    const intent = ledger.Intent.new(new Date(Date.now() + 60_000));
    const offer = ledger.UnshieldedOffer.new(inputs, outputs, []);
    if (fallible) intent.fallibleUnshieldedOffer = offer;
    else intent.guaranteedUnshieldedOffer = offer;
    const unproven = ledger.Transaction.fromParts('preprod', undefined, undefined, intent);
    return unproven.prove(noProver, ledger.CostModel.initialCostModel()) as Promise<UnboundTransaction>;
  }

  it('counts inputs the dapp spends from the wallet’s own address, in either offer', async () => {
    expect(countWalletOwnedInputs(await txWith([spend(walletKey, 7n)], [{ value: 7n, owner: OTHER, type: NIGHT }]), WALLET)).toBe(1);
    expect(countWalletOwnedInputs(await txWith([spend(walletKey, 7n)], [{ value: 7n, owner: OTHER, type: NIGHT }], true), WALLET)).toBe(1);
    expect(countWalletOwnedInputs(await txWith([spend(otherKey, 7n)], [{ value: 7n, owner: OTHER, type: NIGHT }]), WALLET)).toBe(0);
    expect(countWalletOwnedInputs(await unboundEnvelope(), WALLET)).toBe(0);
  });

  it('lists who the transaction pays, leaving out the wallet’s own outputs', async () => {
    const tx = await txWith([], [
      { value: 5n, owner: OTHER, type: NIGHT },
      { value: 3n, owner: OTHER, type: NIGHT },
      { value: 9n, owner: WALLET, type: NIGHT },
    ]);
    expect(summarizeForeignPayments(tx, WALLET)).toEqual([{ token: NIGHT, amount: '8', recipient: OTHER }]);
  });

  it('builds the approval with bech32m recipients, and refuses a tx that spends the wallet’s coins', async () => {
    const codec = await unshieldedAddressCodec('preprod');
    const ownAddress = codec.toBech32(WALLET);
    expect(codec.toHex(ownAddress)).toBe(WALLET);
    const hex = async (tx: Promise<UnboundTransaction>) => Buffer.from((await tx).serialize()).toString('hex');

    const paying = await connectorBalancePrompt(await hex(txWith([], [{ value: 5n, owner: OTHER, type: NIGHT }])), 'preprod', ownAddress);
    expect(paying).toEqual({
      ok: true,
      contributions: [{ token: NIGHT, amount: '5' }],
      payments: [{ token: NIGHT, amount: '5', recipient: codec.toBech32(OTHER) }],
    });

    const draining = await connectorBalancePrompt(
      await hex(txWith([spend(walletKey, 50n)], [{ value: 50n, owner: OTHER, type: NIGHT }])), 'preprod', ownAddress,
    );
    expect(draining).toMatchObject({ ok: false, reason: expect.stringMatching(/already spends from this wallet/) });

    expect(await connectorBalancePrompt('00', 'preprod', ownAddress)).toMatchObject({ ok: false, reason: expect.stringMatching(/not a valid/) });
  });
});

describe('isSealedMidnightTransaction', () => {
  it('recognises a sealed envelope and rejects unbound, unproven and malformed input', async () => {
    const sealed = Buffer.from((await unboundEnvelope()).bind().serialize()).toString('hex');
    const unbound = Buffer.from((await txNeeding(1n)).serialize()).toString('hex');
    const unproven = Buffer.from(ledger.Transaction.fromParts('preprod').serialize()).toString('hex');
    await expect(isSealedMidnightTransaction(sealed, 'preprod')).resolves.toBe(true);
    await expect(isSealedMidnightTransaction(unbound, 'preprod')).resolves.toBe(false);
    await expect(isSealedMidnightTransaction(unproven, 'preprod')).resolves.toBe(false);
    await expect(isSealedMidnightTransaction('zz', 'preprod')).resolves.toBe(false);
    await expect(isSealedMidnightTransaction(sealed, 'preview')).resolves.toBe(false);
  });
});
