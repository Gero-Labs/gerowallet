// GEROVAULT_SIGN_VAULT_BUNDLE in the background (signBundleFlow.ts): the password under the
// back-off first, then the stored vault, the bundle read again and held to the sheet, then the key
// at the record's own index, checked against the record's credential, used once and wiped. Only a
// witness file comes back. Keys are generated here.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import type { UnsignedTxBundle, VaultRecord } from '@/modules/gerovault/contracts';
import { WalletType } from '@/models/types';
import { buildVaultSpend } from './buildSpend';
import { createUnsignedBundle } from './bundle';
import { TIP_CLOCK_TOLERANCE_MS, signVaultBundleFlow, slotOnNetwork, type SignVaultBundleDeps } from './signBundleFlow';
import { VALIDITY_START_TOLERANCE_SLOTS } from './constants';
import { spendContextOf, type VaultSpendContext } from './vaultSpendContext';
import { verifyWitnessFile } from './witnesses';
import { TEST_PARAMS, fundingTransaction, lovelaceOutput, payeeAddress, seededRandom, testOwner, testReader, testVaultRecord, type TestOwner } from './__fixtures__/testVault';

const TIP = 80_000_000;
const WALLET = { id: 21, network: 'Preprod', type: WalletType.Normal, encryptionMethod: 'password' as const, encryptedPrivateKey: 'sealed' };

let owners: TestOwner[];
let records: VaultRecord[];
let bundle: UnsignedTxBundle;

beforeAll(async () => {
  owners = [await testOwner(1), await testOwner(2), await testOwner(3)];
  records = await Promise.all(owners.map((_, i) => testVaultRecord(owners, 2, i)));
  const proposer = await spendContextOf(records[0]);
  const funding = fundingTransaction([lovelaceOutput(proposer.baseAddress, 40_000_000n)]);
  const { reader } = testReader([funding]);
  const built = await buildVaultSpend({
    context: proposer,
    utxos: await reader.utxos(proposer.baseAddress),
    recipients: [{ address: payeeAddress(), lovelace: 10_000_000n }],
    protocolParameters: TEST_PARAMS,
    currentSlot: TIP,
    random: seededRandom(3),
  });
  bundle = await createUnsignedBundle(proposer, built, reader.txCbor, 1_700_000_000_000);
});

/** The background of owner `who`'s wallet, with its record stored. */
function background(who: number, overrides: Partial<SignVaultBundleDeps> = {}) {
  let opened: Uint8Array | undefined;
  const deps: SignVaultBundleDeps = {
    wallet: () => WALLET,
    verifyPassword: vi.fn(async (password: string) => password === 'right'),
    decryptRootKey: vi.fn((encrypted: string, password: string) => {
      if (encrypted !== 'sealed' || password !== 'right') throw new Error('bad password');
      opened = Uint8Array.from(owners[who].rootKey);
      return opened;
    }),
    getVault: vi.fn(async (walletId: number, vaultId: string) => (walletId === WALLET.id && vaultId === records[who].vaultId ? records[who] : undefined)),
    acceptedVaults: vi.fn(async () => [records[who]]),
    currentSlot: () => TIP + 30,
    now: () => 1_700_000_005_000,
    ...overrides,
  };
  return { deps, opened: () => opened };
}

const request = (who: number, extra: Record<string, unknown> = {}) => ({ walletId: WALLET.id, vaultId: records[who].vaultId, bundle, password: 'right', ...extra });

const code = async (promise: Promise<unknown>) => promise.then(() => 'signed', (error: { code?: string; detail?: string }) => error.code);

describe('signing a vault bundle in the background', () => {
  it('returns only a witness file, by this wallet\'s own key at its index, and wipes the opened key', async () => {
    const { deps, opened } = background(1);
    const file = await signVaultBundleFlow(request(1), deps);

    expect(Object.keys(file).sort()).toEqual(['bundleHash', 'createdAt', 'network', 'signerKeyHash', 'txId', 'type', 'vaultId', 'version', 'vkeyWitnesses']);
    expect(file.signerKeyHash).toBe(owners[1].credential);
    expect(file.vkeyWitnesses).toEqual([expect.objectContaining({ vkey: owners[1].keys.payment })]);
    expect(file.createdAt).toBe(1_700_000_005_000);
    // The proposer's device accepts it as any cosigner's file.
    const verified = await verifyWitnessFile(file, bundle, await spendContextOf(records[0]));
    expect(verified.signer.credential).toBe(owners[1].credential);
    expect(opened()?.every(byte => byte === 0)).toBe(true);
    expect(JSON.stringify(file)).not.toContain(Buffer.from(owners[1].rootKey).toString('hex'));
  });

  it('refuses a wrong password before reading the vault or opening any key', async () => {
    const { deps } = background(1);
    expect(await code(signVaultBundleFlow(request(1, { password: 'wrong' }), deps))).toBe('wrong-password');
    expect(await code(signVaultBundleFlow(request(1, { password: '' }), deps))).toBe('wrong-password');
    expect(deps.getVault).not.toHaveBeenCalled();
    expect(deps.decryptRootKey).not.toHaveBeenCalled();
  });

  it('lets the back-off\'s own error through, and never opens the key during a wait', async () => {
    const throttled = Object.assign(new Error('Too many attempts'), { retryAfterMs: 30_000 });
    const { deps } = background(1, { verifyPassword: vi.fn(async () => { throw throttled; }) });
    await expect(signVaultBundleFlow(request(1), deps)).rejects.toBe(throttled);
    expect(deps.decryptRootKey).not.toHaveBeenCalled();
  });

  it('refuses when the key at the record\'s index is not the credential the record holds, and still wipes it', async () => {
    // Owner 2's root key behind owner 1's record: the key at index 2 is not owner 1's credential.
    const { deps, opened } = background(1, {
      decryptRootKey: vi.fn(() => Uint8Array.from(owners[2].rootKey)),
    });
    expect(await code(signVaultBundleFlow(request(1), deps))).toBe('key-mismatch');
    const wrongIndex = background(1, { getVault: vi.fn(async () => ({ ...records[1], ownIndex: 9 })) });
    expect(await code(signVaultBundleFlow(request(1), wrongIndex.deps))).toBe('key-mismatch');
    expect(wrongIndex.opened()?.every(byte => byte === 0)).toBe(true);
    expect(opened()).toBeUndefined();
  });

  it('refuses a bundle the sheet refuses, before any key is opened', async () => {
    const expired = background(1, { currentSlot: () => TIP + 10 * 24 * 3600 });
    await expect(signVaultBundleFlow(request(1), expired.deps)).rejects.toMatchObject({ code: 'bundle-refused', detail: 'expired' });
    const noTip = background(1, { currentSlot: () => null });
    expect(await code(signVaultBundleFlow(request(1), noTip.deps))).toBe('bundle-refused');
    for (const deps of [expired.deps, noTip.deps]) expect(deps.decryptRootKey).not.toHaveBeenCalled();
  });

  it('reads the bundle as a file is read: altered, reshaped or another vault\'s, it is refused', async () => {
    const { deps } = background(1);
    const flipped = bundle.bodyCbor.slice(0, -2) + (bundle.bodyCbor.endsWith('00') ? '01' : '00');
    for (const altered of [
      { ...bundle, bodyCbor: flipped },
      { ...bundle, extra: true },
      { ...bundle, txId: 'ab'.repeat(32) },
      'not a bundle',
      null,
    ]) {
      expect(await code(signVaultBundleFlow(request(1, { bundle: altered }), deps))).toBe('bundle-invalid');
    }
    const other = await testVaultRecord(owners, 3, 1);
    const elsewhere = background(1, { getVault: vi.fn(async () => other) });
    expect(await code(signVaultBundleFlow(request(1, { vaultId: other.vaultId }), elsewhere.deps))).toBe('bundle-invalid');
    expect(deps.decryptRootKey).not.toHaveBeenCalled();
  });

  it('signs only for the logged-in software wallet, an accepted vault and one of its owners', async () => {
    expect(await code(signVaultBundleFlow(request(1, { walletId: 99 }), background(1).deps))).toBe('not-found');
    expect(await code(signVaultBundleFlow(request(1), background(1, { wallet: () => null }).deps))).toBe('not-found');
    expect(await code(signVaultBundleFlow(request(1), background(1, { wallet: () => ({ ...WALLET, type: WalletType.Ledger }) }).deps))).toBe('not-supported');
    expect(await code(signVaultBundleFlow(request(1), background(1, { wallet: () => ({ ...WALLET, encryptionMethod: 'prf' as never }) }).deps))).toBe('not-supported');
    expect(await code(signVaultBundleFlow(request(1, { vaultId: 'cd'.repeat(32) }), background(1).deps))).toBe('not-found');
    const candidate = background(1, { getVault: vi.fn(async () => ({ ...records[1], status: 'candidate' as const })) });
    expect(await code(signVaultBundleFlow(request(1), candidate.deps))).toBe('not-accepted');
    const broken = background(1, { getVault: vi.fn(async () => ({ ...records[1], paymentScriptHash: 'ef'.repeat(28) })) });
    expect(await code(signVaultBundleFlow(request(1), broken.deps))).toBe('vault-invalid');
  });

  it('signs only on a network the slice opens, and only for a vault on the wallet\'s own network', async () => {
    const mainnet = await testVaultRecord(owners, 2, 1, { network: 'mainnet' });
    const onMainnet = background(1, { wallet: () => ({ ...WALLET, network: 'Mainnet' }), getVault: vi.fn(async () => mainnet) });
    expect(await code(signVaultBundleFlow(request(1, { vaultId: mainnet.vaultId }), onMainnet.deps))).toBe('network-closed');
    const previewWallet = background(1, { wallet: () => ({ ...WALLET, network: 'Preview' }) });
    expect(await code(signVaultBundleFlow(request(1), previewWallet.deps))).toBe('network-closed');
    const noNetwork = background(1, { wallet: () => ({ ...WALLET, network: undefined }) });
    expect(await code(signVaultBundleFlow(request(1), noNetwork.deps))).toBe('network-closed');
    for (const deps of [onMainnet.deps, previewWallet.deps, noNetwork.deps]) expect(deps.decryptRootKey).not.toHaveBeenCalled();
  });
});

describe('the bundle the background re-checks, built by hand', () => {
  /** A spend of 10 ADA from the vault, with `change` merged into the change output and `validity` into the interval. */
  async function handBuilt(context: VaultSpendContext, change: Partial<Cardano.TxOut> = {}, validity: Partial<Cardano.ValidityInterval> = {}) {
    const funding = fundingTransaction([lovelaceOutput(context.baseAddress, 40_000_000n)], 7);
    const { reader } = testReader([funding]);
    const body: Cardano.TxBody = {
      inputs: [{ txId: Cardano.TransactionId(funding.id), index: 0 }],
      outputs: [lovelaceOutput(payeeAddress(), 10_000_000n), { ...lovelaceOutput(context.baseAddress, 29_800_000n), ...change }],
      fee: 200_000n,
      validityInterval: { invalidHereafter: Cardano.Slot(TIP + 3600), ...validity },
    };
    const bodyCbor = Serialization.TransactionBody.fromCore(body).toCbor();
    return createUnsignedBundle(context, { bodyCbor, txId: Serialization.TransactionBody.fromCbor(HexBlob(bodyCbor)).hash() }, reader.txCbor, 1);
  }

  it('signs a clean spend, and refuses change to the vault that carries a datum before opening the key', async () => {
    const context = await spendContextOf(records[1]);
    const clean = await handBuilt(context);
    expect((await signVaultBundleFlow(request(1, { bundle: clean }), background(1).deps)).txId).toBe(clean.txId);

    const withDatum = await handBuilt(context, { datum: Serialization.PlutusData.fromCbor(HexBlob('d87980')).toCore() });
    const { deps } = background(1);
    await expect(signVaultBundleFlow(request(1, { bundle: withDatum }), deps)).rejects.toMatchObject({ code: 'bundle-refused', detail: 'vault_output_datum' });
    expect(deps.decryptRootKey).not.toHaveBeenCalled();
  });

  it('bounds a validity start: not ahead of the tip beyond the tolerance, not older than the expiry window', async () => {
    const context = await spendContextOf(records[1]);
    const tip = TIP + 30;
    const soon = await handBuilt(context, {}, { invalidBefore: Cardano.Slot(tip + VALIDITY_START_TOLERANCE_SLOTS) });
    expect((await signVaultBundleFlow(request(1, { bundle: soon }), background(1).deps)).txId).toBe(soon.txId);
    const later = await handBuilt(context, {}, { invalidBefore: Cardano.Slot(tip + VALIDITY_START_TOLERANCE_SLOTS + 1) });
    await expect(signVaultBundleFlow(request(1, { bundle: later }), background(1).deps)).rejects.toMatchObject({ code: 'bundle-refused', detail: 'validity_start_future' });
    const old = await handBuilt(context, {}, { invalidBefore: Cardano.Slot(tip - 7 * 24 * 3600 - 1) });
    await expect(signVaultBundleFlow(request(1, { bundle: old }), background(1).deps)).rejects.toMatchObject({ code: 'bundle-refused', detail: 'validity_start_too_old' });
  });
});

describe('the worker\'s tip, read on the vault\'s network', () => {
  const NOW = Date.UTC(2026, 10, 26, 12);
  const preprodNow = 86_400 + (NOW / 1000 - 1_655_769_600);
  const mainnetNow = 4_492_800 + (NOW / 1000 - 1_596_059_091);

  it('takes a slot only when it is that network\'s now, within a day', () => {
    expect(slotOnNetwork('preprod', preprodNow, NOW)).toBe(preprodNow);
    expect(slotOnNetwork('preprod', preprodNow - 3600, NOW)).toBe(preprodNow - 3600);
    expect(slotOnNetwork('preprod', preprodNow - TIP_CLOCK_TOLERANCE_MS / 1000 - 1, NOW)).toBeNull();
    expect(slotOnNetwork('preprod', mainnetNow, NOW)).toBeNull();
    expect(slotOnNetwork('mainnet', preprodNow, NOW)).toBeNull();
    expect(slotOnNetwork('preprod', Number.NaN, NOW)).toBeNull();
    expect(slotOnNetwork('preprod', -1, NOW)).toBeNull();
  });

  it('refuses a far expiry that another network\'s tip would have let through', async () => {
    // Built against a mainnet tip: on preprod its expiry lies years ahead.
    const context = await spendContextOf(records[1]);
    const { reader } = testReader([fundingTransaction([lovelaceOutput(context.baseAddress, 40_000_000n)])]);
    const built = await buildVaultSpend({
      context,
      utxos: await reader.utxos(context.baseAddress),
      recipients: [{ address: payeeAddress(), lovelace: 5_000_000n }],
      protocolParameters: TEST_PARAMS,
      currentSlot: mainnetNow,
      random: seededRandom(3),
    });
    const farBundle = await createUnsignedBundle(context, built, reader.txCbor, 1);
    const worker = (tipSlot: number) => background(1, { currentSlot: network => slotOnNetwork(network, tipSlot, NOW) });
    // The stored tip is mainnet's: it is no tip for a preprod vault, so the sheet refuses.
    await expect(signVaultBundleFlow(request(1, { bundle: farBundle }), worker(mainnetNow).deps)).rejects.toMatchObject({ code: 'bundle-refused', detail: 'expired' });
    // With preprod's own tip the expiry is seen for what it is.
    await expect(signVaultBundleFlow(request(1, { bundle: farBundle }), worker(preprodNow).deps)).rejects.toMatchObject({ code: 'bundle-refused', detail: 'expiry_too_far' });
  });
});
