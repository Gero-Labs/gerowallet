// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { CoreWallet, CoinsAndBalances, Keys, Transacting } from 'midnight-v9-shielded/v2';
import { ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from 'midnight-v9-address-format';
import { buildAndSignShieldedLedger9Transfer } from './midnightShieldedLedger9';
import { buildAndSignShield } from './midnightShieldSwapBuilder';
import type { BuildAndSignShieldedTransferArgs } from './midnightShieldedBuilder';
import { LEDGER8_PROTOCOL_VERSION, LEDGER9_PROTOCOL_VERSION_SAMPLE, useMidnightChains } from '@test/helpers/midnightChains';

const mocks = vi.hoisted(() => ({
  factory: vi.fn(), forking: vi.fn(), fees: vi.fn(), prove: vi.fn(), load: vi.fn(), save: vi.fn(), clear: vi.fn(),
  identity: vi.fn(), unchanged: vi.fn(),
}));
vi.mock('midnight-v9-shielded', () => ({ CustomShieldedWallet: mocks.factory, ShieldedWallet: mocks.forking }));
vi.mock('./midnightLedger9', () => ({ balanceLedger9Fees: mocks.fees }));
vi.mock('./midnightUnshieldedProver', () => ({ proveUnshieldedTransfer: mocks.prove }));
vi.mock('./midnightWalletStatePersistence', () => ({
  loadWalletState: mocks.load, saveWalletState: mocks.save, clearWalletState: mocks.clear,
}));
vi.mock('./midnightChainIdentity', () => ({
  readVerifiedMidnightChainIdentity: mocks.identity,
  midnightCheckpointNamespace: (identity: { chain_generation: number }) => `verified-stagenet-${identity.chain_generation}`,
  assertMidnightChainIdentityUnchanged: mocks.unchanged,
}));

const token = 'aa'.repeat(32);
const seed = new Uint8Array(32).fill(3);
const recipientSeed = new Uint8Array(32).fill(4);
function address(keys: ledger.ZswapSecretKeys) {
  return new ShieldedAddress(ShieldedCoinPublicKey.fromHexString(keys.coinPublicKey),
    ShieldedEncryptionPublicKey.fromHexString(keys.encryptionPublicKey));
}
function args(): BuildAndSignShieldedTransferArgs {
  const recipient = ledger.ZswapSecretKeys.fromSeed(recipientSeed);
  try {
    return {
      sdkNetworkId: 'stagenet',
      endpoints: { sdkNetworkId: 'stagenet', publicIndexerUrl: 'https://indexer.invalid', publicIndexerWsUrl: 'wss://indexer.invalid' } as BuildAndSignShieldedTransferArgs['endpoints'],
      zswapSecretKeySeed: seed, dustSecretSeed: new Uint8Array(32).fill(5),
      outputs: [{ receiverAddress: ShieldedAddress.codec.encode('stagenet', address(recipient)).toString(), amount: 60n, tokenType: token }],
    };
  } finally { recipient.clear(); }
}

let stamp = 0n;
function realWallet(network = 'stagenet') {
  const keys = ledger.ZswapSecretKeys.fromSeed(seed);
  const coin = { nonce: '11'.repeat(32), type: token, value: 100n };
  const output = ledger.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey);
  const core = CoreWallet.apply(CoreWallet.initEmpty(keys, network), keys,
    ledger.ZswapOffer.fromOutput(output, token, 100n));
  const publicAddress = address(keys);
  keys.clear();
  const capability = Transacting.makeDefaultTransactingCapability({ networkId: network }, () => ({
    coinSelection: (coins, type) => coins.find(coin => coin.type === type),
    coinsAndBalancesCapability: CoinsAndBalances.makeDefaultCoinsAndBalancesCapability(),
    keysCapability: Keys.makeDefaultKeysCapability(),
  }));
  return {
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
    state: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
    waitForSyncedState: vi.fn().mockResolvedValue(publicAddress),
    serializeState: vi.fn().mockResolvedValue('real-sdk-checkpoint-boundary'),
    // SDK 2 keeps the keys the wallet was started with and returns a handle.
    transferTransaction: vi.fn(async (outputs) => {
      const secrets = ledger.ZswapSecretKeys.fromSeed(seed);
      try {
        const result = capability.makeTransfer(secrets, core, outputs);
        if (result._tag === 'Left') throw result.left;
        const tx = result.right[0];
        return { protocolVersion: stamp, serialize: () => tx.serialize() };
      } finally { secrets.clear(); }
    }),
  };
}

describe('ledger-9 shielded send orchestration with real SDK note construction', () => {
  let wallet: ReturnType<typeof realWallet>;
  beforeEach(() => {
    vi.resetAllMocks();
    wallet = realWallet();
    mocks.factory.mockReturnValue({ startWithSecretKeys: () => wallet, restore: () => wallet });
    mocks.fees.mockResolvedValue(ledger.Transaction.fromParts('stagenet'));
    mocks.load.mockResolvedValue(null);
    mocks.save.mockResolvedValue(undefined);
    mocks.clear.mockResolvedValue(undefined);
    mocks.identity.mockResolvedValue({ chain_generation: 7 });
    mocks.unchanged.mockResolvedValue(undefined);
  });

  it('builds a balanced custom-token transfer with real recipient encryption and change', async () => {
    const result = await buildAndSignShieldedLedger9Transfer(args());
    expect(result.proven).toBe(false);
    const tx = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', Buffer.from(result.txHex, 'hex'));
    expect([...tx.imbalances(0)]).toEqual([]);
    expect(tx.guaranteedOffer?.inputs).toHaveLength(1);
    expect(tx.guaranteedOffer?.outputs).toHaveLength(2);
    const recipient = ledger.ZswapSecretKeys.fromSeed(recipientSeed);
    try {
      const received = CoreWallet.apply(CoreWallet.initEmpty(recipient, 'stagenet'), recipient, tx.guaranteedOffer!);
      expect([...received.state.coins].map(coin => coin.value)).toEqual([60n]);
    } finally { recipient.clear(); }
    expect(wallet.waitForSyncedState).toHaveBeenCalledWith();
    // SDK 2 starts with one ledger's keys per variant; this wallet runs the ledger 9 one only.
    expect(wallet.start).toHaveBeenCalledWith({ v9: expect.anything() });
    expect(mocks.load).toHaveBeenCalledWith('verified-stagenet-7', 'shielded', seed);
    expect(mocks.fees).toHaveBeenCalledOnce();
    expect(mocks.unchanged).toHaveBeenCalledTimes(2);
    expect(wallet.stop).toHaveBeenCalledOnce();
  });

  it.each(['native', '00'.repeat(32)])('rejects native NIGHT type %s before synchronization', async tokenType => {
    const input = args();
    await expect(buildAndSignShieldedLedger9Transfer({ ...input, outputs: [{ ...input.outputs[0], tokenType }] })).rejects.toThrow('unshielded token');
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('rejects wrong-network addresses before synchronization', async () => {
    const input = args();
    const receiver = ledger.ZswapSecretKeys.fromSeed(recipientSeed);
    try {
      await expect(buildAndSignShieldedLedger9Transfer({ ...input, outputs: [{ ...input.outputs[0],
        receiverAddress: ShieldedAddress.codec.encode('preprod', address(receiver)).toString() }] })).rejects.toThrow();
    } finally { receiver.clear(); }
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('never builds or funds a transaction after synchronization fails', async () => {
    wallet.waitForSyncedState.mockRejectedValue(new Error('indexer disconnected'));
    await expect(buildAndSignShieldedLedger9Transfer(args())).rejects.toThrow('indexer disconnected');
    expect(wallet.transferTransaction).not.toHaveBeenCalled();
    expect(mocks.fees).not.toHaveBeenCalled();
    expect(wallet.stop).toHaveBeenCalledOnce();
  });

  it('rejects insufficient private funds in the real SDK before fee preparation', async () => {
    const input = args();
    await expect(buildAndSignShieldedLedger9Transfer({ ...input,
      outputs: [{ ...input.outputs[0], amount: 101n }],
    })).rejects.toThrow();
    expect(mocks.fees).not.toHaveBeenCalled();
    expect(wallet.stop).toHaveBeenCalledOnce();
  });

  it('never saves or builds from a checkpoint after identity verification fails', async () => {
    mocks.unchanged.mockRejectedValue(new Error('genesis unavailable'));
    await expect(buildAndSignShieldedLedger9Transfer(args())).rejects.toThrow('genesis unavailable');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(wallet.transferTransaction).not.toHaveBeenCalled();
    expect(wallet.stop).toHaveBeenCalledOnce();
  });

  it('refuses a restored checkpoint for another key', async () => {
    mocks.load.mockResolvedValue('checkpoint');
    wallet.waitForSyncedState.mockResolvedValue({ coinPublicKey: { toHexString: () => 'wrong' } });
    await expect(buildAndSignShieldedLedger9Transfer(args())).rejects.toThrow('different wallet');
    expect(mocks.clear).toHaveBeenCalledWith('verified-stagenet-7', 'shielded', seed);
    expect(mocks.fees).not.toHaveBeenCalled();
  });

  it('refuses a transaction when the chain changes during fee preparation', async () => {
    mocks.unchanged.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('chain changed'));
    await expect(buildAndSignShieldedLedger9Transfer(args())).rejects.toThrow('chain changed');
    expect(mocks.prove).not.toHaveBeenCalled();
    expect(wallet.stop).toHaveBeenCalledOnce();
  });

  it('propagates proof failure without returning an unproven fallback', async () => {
    mocks.prove.mockRejectedValue(new Error('proof server unavailable'));
    await expect(buildAndSignShieldedLedger9Transfer({ ...args(), proving: { url: 'http://localhost:6300' } })).rejects.toThrow('proof server unavailable');
    expect(wallet.stop).toHaveBeenCalledOnce();
  });

  it('shows with real ledger imbalances why public NIGHT cannot fund private zero-color notes', () => {
    const keys = ledger.ZswapSecretKeys.fromSeed(seed);
    try {
      const raw = '00'.repeat(32);
      const output = ledger.ZswapOutput.new({ nonce: '11'.repeat(32), type: raw, value: 100n }, 0, keys.coinPublicKey, keys.encryptionPublicKey);
      const privateTx = ledger.Transaction.fromParts('stagenet', ledger.ZswapOffer.fromOutput(output, raw, 100n));
      const intent = ledger.Intent.new(new Date('2030-01-01'));
      intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([{ value: 100n, owner: ledger.signatureVerifyingKey({ tag: 'schnorr', value: '01'.repeat(32) }), type: raw, intentHash: '22'.repeat(32), outputNo: 0 }], [], []);
      const combined = privateTx.merge(ledger.Transaction.fromParts('stagenet', undefined, undefined, intent));
      expect([...combined.imbalances(0)].map(([type, value]) => [type.tag, value])).toEqual(expect.arrayContaining([
        ['unshielded', 100n], ['shielded', -100n],
      ]));
    } finally { keys.clear(); }
  });

  it('rejects the obsolete conversion entry before reading any credentials or endpoints', async () => {
    await expect(buildAndSignShield(undefined as never)).rejects.toThrow('application contract');
    expect(mocks.factory).not.toHaveBeenCalled();
  });
});

// #1452 M9: a chain that crossed the upgrade (mainnet, preprod) has notes from
// before it, which only the fork-aware wallet reads.
describe('ledger 9 shielded send on a chain that crossed the upgrade', () => {
  let wallet: ReturnType<typeof realWallet>;
  const preprodArgs = (): BuildAndSignShieldedTransferArgs => {
    const base = args();
    const recipient = ledger.ZswapSecretKeys.fromSeed(recipientSeed);
    try {
      return { ...base, sdkNetworkId: 'preprod',
        endpoints: { ...base.endpoints, sdkNetworkId: 'preprod' } as BuildAndSignShieldedTransferArgs['endpoints'],
        outputs: [{ ...base.outputs[0], receiverAddress: ShieldedAddress.codec.encode('preprod', address(recipient)).toString() }] };
    } finally { recipient.clear(); }
  };
  beforeEach(() => {
    vi.resetAllMocks();
    useMidnightChains({ preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION] });
    wallet = realWallet('preprod');
    mocks.forking.mockReturnValue({ startWithKeys: async () => wallet, restore: () => wallet });
    mocks.fees.mockResolvedValue(ledger.Transaction.fromParts('preprod'));
    mocks.load.mockResolvedValue(null);
    mocks.save.mockResolvedValue(undefined);
    mocks.identity.mockResolvedValue({ chain_generation: 7 });
    mocks.unchanged.mockResolvedValue(undefined);
  });

  it('builds with the fork-aware wallet, started with both ledgers\' keys, once it is on ledger 9', async () => {
    stamp = 2_001_100n;
    const result = await buildAndSignShieldedLedger9Transfer(preprodArgs());
    expect(result.proven).toBe(false);
    expect(mocks.factory).not.toHaveBeenCalled();
    expect(mocks.forking).toHaveBeenCalledWith(expect.objectContaining({ networkId: 'preprod', forks: { v9: 2_000_000n } }));
    expect(wallet.start).toHaveBeenCalledWith({ v8: expect.anything(), v9: expect.anything() });
  });

  it('refuses while the wallet is still on the ledger 8 side, before any fee', async () => {
    stamp = 1_000_000n;
    await expect(buildAndSignShieldedLedger9Transfer(preprodArgs())).rejects.toThrow('caught up with the ledger 9 upgrade');
    expect(mocks.fees).not.toHaveBeenCalled();
  });
});

