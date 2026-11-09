// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { buildConnectorIntent, IntentInsufficientFundsError } from './midnightIntentBuilder';
import type { BuildConnectorIntentDeps, IntentSdkWallet } from './midnightIntentBuilder';
import type { ConnectorIntentRequest } from './midnightConnectorIntent';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
// Same reason as midnightDappBalancer.spec: the real prover client statically
// imports ledger-v9; the provider is injected here anyway.
vi.mock('./midnightLocalProver', () => ({
  makeLocalProvingProvider: () => ({
    check: async () => { throw new Error('unexpected /check'); },
    prove: async () => { throw new Error('unexpected /prove'); },
  }),
}));

/** Circuit-free envelopes never reach the prover; this one proves it. */
const noProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected /check'); },
  prove: async () => { throw new Error('unexpected /prove'); },
};

const NIGHT = '0'.repeat(64);
const FOO = 'ab'.repeat(32);
// Synthetic keys sampled per run — never hold funds.
const SIGNING_KEY = ledger.sampleSigningKey();
const WALLET_KEY = ledger.signatureVerifyingKey(SIGNING_KEY);
const WALLET_ADDRESS = ledger.addressFromKey(WALLET_KEY);
const STRANGER = ledger.addressFromKey(ledger.signatureVerifyingKey(ledger.sampleSigningKey()));

const bech32 = (hex: string) => UnshieldedAddress.codec.encode('preprod', new UnshieldedAddress(Buffer.from(hex, 'hex'))).asString();

/** Give 30 NIGHT (from a 50 NIGHT coin, 20 change), want 7 FOO paid to the wallet. */
const REQUEST: ConnectorIntentRequest = {
  inputs: [{ type: NIGHT, value: '30' }],
  outputs: [{ kind: 'unshielded', type: FOO, value: '7', recipient: bech32(WALLET_ADDRESS) }],
  intentId: 7,
  payFees: false,
};

type Output = { value: bigint; owner: string; type: string };

/** What the SDK's initSwap returns: ONE intent at segment 1 with a guaranteed offer. */
function swapTx(outputs: Output[], inputOwner = WALLET_KEY, inputValue = 50n): ledger.UnprovenTransaction {
  const intent = ledger.Intent.new(new Date(Date.now() + 60 * 60_000));
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
    [{ value: inputValue, owner: inputOwner, type: NIGHT, intentHash: ledger.sampleIntentHash(), outputNo: 0 }],
    outputs,
    [],
  );
  return ledger.Transaction.fromParts('preprod', undefined, undefined, intent);
}

const HONEST_OUTPUTS: Output[] = [
  { value: 20n, owner: WALLET_ADDRESS, type: NIGHT },
  { value: 7n, owner: WALLET_ADDRESS, type: FOO },
];

function fakeDeps(swap: () => Promise<ledger.UnprovenTransaction>, overrides: Partial<BuildConnectorIntentDeps> = {}) {
  const order: string[] = [];
  const wallet = {
    waitForSyncedState: vi.fn(async () => { order.push('sync'); }),
    initSwap: vi.fn(async () => { order.push('initSwap'); return swap(); }),
    signUnboundTransaction: vi.fn<IntentSdkWallet['signUnboundTransaction']>(async (tx) => { order.push('sign'); return tx; }),
    stop: vi.fn(async () => { order.push('stop'); }),
  };
  const keystore = { signData: vi.fn((data: Uint8Array) => ledger.signData(SIGNING_KEY, data)), getAddress: () => WALLET_ADDRESS };
  const deps: BuildConnectorIntentDeps = {
    startUnshieldedWallet: vi.fn(async () => ({ wallet: wallet as unknown as IntentSdkWallet, keystore })),
    balanceFees: vi.fn(async () => { order.push('fees'); return ledger.Transaction.fromParts('preprod'); }),
    provingProvider: vi.fn(async () => { order.push('prover'); return noProver; }),
    ...overrides,
  };
  return { deps, order, wallet };
}

const base = {
  sdkNetworkId: 'preprod',
  endpoints: {
    sdkNetworkId: 'preprod', publicIndexerUrl: 'https://indexer.invalid', publicIndexerWsUrl: 'wss://indexer.invalid',
  } as never,
  unshieldedSecretKey: new Uint8Array(32).fill(1),
  dustSecretSeed: new Uint8Array(32).fill(2),
  proving: { url: 'http://localhost:6300' },
};

function sealed(hex: string) {
  return (ledger.Transaction as unknown as {
    deserialize: (s: string, p: string, b: string, raw: Uint8Array) => ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.Binding>;
  }).deserialize('signature', 'proof', 'binding', Buffer.from(hex, 'hex'));
}

const imbalances = (tx: { imbalances(segment: number): Map<ledger.TokenType, bigint> }) =>
  Object.fromEntries([...tx.imbalances(0)].map(([token, value]) => [(token as { raw: string }).raw, value]));

describe('buildConnectorIntent', () => {
  it('without fees: syncs, builds, moves the intent to the requested segment, signs, seals and stops', async () => {
    const { deps, order, wallet } = fakeDeps(async () => swapTx(HONEST_OUTPUTS));
    const result = await buildConnectorIntent({ ...base, request: REQUEST }, deps);

    expect(order).toEqual(['sync', 'initSwap', 'sign', 'stop']);
    expect(deps.balanceFees).not.toHaveBeenCalled();
    expect(deps.provingProvider).not.toHaveBeenCalled();
    // What the SDK was asked for: give 30 NIGHT, want 7 FOO at the requested recipient.
    const [give, wants] = wallet.initSwap.mock.calls[0] as unknown as [Record<string, bigint>, Array<{ amount: bigint; type: string; receiverAddress: UnshieldedAddress }>];
    expect({ ...give }).toEqual({ [NIGHT]: 30n });
    expect(wants.map((w) => [w.amount, w.type, w.receiverAddress.hexString])).toEqual([[7n, FOO, WALLET_ADDRESS]]);

    expect(result.segmentId).toBe(7);
    const tx = sealed(result.txHex);
    expect([...(tx.intents?.keys() ?? [])]).toEqual([7]);
    // Purposefully imbalanced: +30 NIGHT given, -7 FOO wanted.
    expect(imbalances(tx)).toEqual({ [NIGHT]: 30n, [FOO]: -7n });
  });

  it('signs after the segment move, so the sealed signature verifies for the final segment', async () => {
    const { deps, wallet } = fakeDeps(async () => swapTx(HONEST_OUTPUTS));
    // Sign the way the SDK does: each intent's signatureData(segment), one signature per input.
    wallet.signUnboundTransaction.mockImplementation(async (tx, sign) => {
      const signed = tx as unknown as { intents: Map<number, { signatureData(id: number): Uint8Array; guaranteedUnshieldedOffer?: { inputs: unknown[]; addSignatures(s: ledger.Signature[]): unknown } }> };
      for (const [segment, intent] of signed.intents) {
        const offer = intent.guaranteedUnshieldedOffer;
        if (!offer) continue;
        const signature = sign(intent.signatureData(segment));
        intent.guaranteedUnshieldedOffer = offer.addSignatures(offer.inputs.map(() => signature)) as typeof offer;
        signed.intents = signed.intents.set(segment, intent);
      }
      return tx;
    });
    const result = await buildConnectorIntent({ ...base, request: { ...REQUEST, intentId: 4242 } }, deps);

    const intent = sealed(result.txHex).intents!.get(4242)!;
    const [signature] = intent.guaranteedUnshieldedOffer!.signatures;
    expect(ledger.verifySignature(WALLET_KEY, intent.signatureData(4242), signature)).toBe(true);
    // The SDK's segment 1 would not verify: the move must come before signing.
    expect(ledger.verifySignature(WALLET_KEY, intent.signatureData(1), signature)).toBe(false);
  });

  it('with fees: prices the DUST fee on the built intent, proves wallet-side, merges', async () => {
    const { deps, order } = fakeDeps(async () => swapTx(HONEST_OUTPUTS));
    const result = await buildConnectorIntent({ ...base, request: { ...REQUEST, intentId: 'random', payFees: true } }, deps);

    expect(order).toEqual(['sync', 'initSwap', 'fees', 'prover', 'sign', 'stop']);
    const [feeArgs, feeTxs] = (deps.balanceFees as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(feeArgs).toMatchObject({ sdkNetworkId: 'preprod', dustSecretSeed: base.dustSecretSeed });
    expect(feeArgs.ttl.getTime()).toBeGreaterThan(Date.now());
    expect([...(feeTxs[0].intents?.keys() ?? [])]).toEqual([result.segmentId]);
    expect(result.segmentId).toBeGreaterThanOrEqual(1);
    expect(result.segmentId).toBeLessThanOrEqual(65_535);
    expect(imbalances(sealed(result.txHex))).toEqual({ [NIGHT]: 30n, [FOO]: -7n });
  });

  it('refuses an output to an address that was not requested, and never signs', async () => {
    const { deps, wallet } = fakeDeps(async () => swapTx([{ value: 20n, owner: STRANGER, type: NIGHT }, HONEST_OUTPUTS[1]]));
    await expect(buildConnectorIntent({ ...base, request: REQUEST }, deps)).rejects.toThrow('not requested');
    expect(wallet.signUnboundTransaction).not.toHaveBeenCalled();
    expect(wallet.stop).toHaveBeenCalled();
  });

  it('refuses a build that drops the wanted output (the counter-leg bug class)', async () => {
    const { deps, wallet } = fakeDeps(async () => swapTx([HONEST_OUTPUTS[0]]));
    await expect(buildConnectorIntent({ ...base, request: REQUEST }, deps)).rejects.toThrow('missing a requested output');
    expect(wallet.signUnboundTransaction).not.toHaveBeenCalled();
  });

  it('refuses a build that gives more than approved', async () => {
    // 50 in, only 10 change back: gives 40 where 30 was approved.
    const { deps } = fakeDeps(async () => swapTx([{ value: 10n, owner: WALLET_ADDRESS, type: NIGHT }, HONEST_OUTPUTS[1]]));
    await expect(buildConnectorIntent({ ...base, request: REQUEST }, deps)).rejects.toThrow('exactly the approved amounts');
  });

  it('refuses a build that spends a coin the wallet does not own', async () => {
    const otherKey = ledger.signatureVerifyingKey(ledger.sampleSigningKey());
    const { deps } = fakeDeps(async () => swapTx(HONEST_OUTPUTS, otherKey));
    await expect(buildConnectorIntent({ ...base, request: REQUEST }, deps)).rejects.toThrow('not this wallet');
  });

  it('maps the SDK insufficient-funds failure to IntentInsufficientFundsError', async () => {
    const { deps, wallet } = fakeDeps(async () => { throw Object.assign(new Error('selection failed'), { _tag: 'Wallet.InsufficientFunds' }); });
    await expect(buildConnectorIntent({ ...base, request: REQUEST }, deps)).rejects.toBeInstanceOf(IntentInsufficientFundsError);
    expect(wallet.stop).toHaveBeenCalled();
  });

  it('refuses Stagenet before starting the wallet', async () => {
    const { deps } = fakeDeps(async () => swapTx(HONEST_OUTPUTS));
    await expect(buildConnectorIntent({ ...base, sdkNetworkId: 'stagenet', request: REQUEST }, deps)).rejects.toThrow('Stagenet');
    expect(deps.startUnshieldedWallet).not.toHaveBeenCalled();
  });
});
