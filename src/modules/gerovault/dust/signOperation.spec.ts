// The background signer on stake and DUST operations: the stake key at 2/i only for an operation
// and only when it hashes to the record's stake key; the collateral key only when the body's
// collateral is this wallet's own first address. Keys are generated here.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ROLE } from '@/shared/gerovault';
import { WalletType } from '@/models/types';
import type { UnsignedTxBundle, VaultRecord } from '@/modules/gerovault/contracts';
import { createUnsignedBundle } from '@/modules/gerovault/spend/bundle';
import { accountCollateralKeyHash, signCollateralWithRootKey, signVaultRoleWithRootKey } from '@/modules/gerovault/spend/signer';
import { signVaultBundleFlow, type SignVaultBundleDeps } from '@/modules/gerovault/spend/signBundleFlow';
import { spendContextOf, type VaultSpendContext } from '@/modules/gerovault/spend/vaultSpendContext';
import { verifyWitnessFile } from '@/modules/gerovault/spend/witnesses';
import { reviewBundle } from '@/modules/gerovault/spend/review';
import { fundingTransaction, lovelaceOutput, testOwner, testReader, testVaultRecord, type TestOwner } from '@/modules/gerovault/spend/__fixtures__/testVault';
import { buildVaultOperation, type OperationRequest } from './buildOperation';
import { dustAddressOf } from './mappingValidator';
import { witnessPlanOf } from './operations';
import { COLLATERAL_PERCENTAGE, OPERATION_PARAMS, TEST_DUST_HEX, collateralWallet, measuredEvaluator, ownerOfWallet, type CollateralWallet } from './__fixtures__/dustVault';

const TIP = 80_000_000;
const TX_ID = 'c0'.repeat(32);

let wallet: CollateralWallet;
let owners: TestOwner[];
let records: VaultRecord[];
let vault: VaultSpendContext;

beforeAll(async () => {
  wallet = await collateralWallet(3);
  owners = [await ownerOfWallet(wallet, 4), await testOwner(2), await testOwner(5)];
  records = await Promise.all(owners.map((_, i) => testVaultRecord(owners, 2, i)));
  vault = await spendContextOf(records[0]);
});

async function bundleFor(request: OperationRequest): Promise<UnsignedTxBundle> {
  const funding = fundingTransaction([lovelaceOutput(vault.baseAddress, 25_000_000n)]);
  const walletFunding = fundingTransaction([lovelaceOutput(wallet.address, 8_000_000n)], 4);
  const { reader } = testReader([funding, walletFunding]);
  const built = await buildVaultOperation({
    context: vault,
    utxos: funding.utxos,
    request,
    chain: { stakeRegistered: request.kind !== 'stake_register', rewards: 0n, registrations: [] },
    protocolParameters: OPERATION_PARAMS,
    currentSlot: TIP,
    collateral: { address: wallet.address, utxos: walletFunding.utxos },
    evaluate: measuredEvaluator,
  });
  return createUnsignedBundle(vault, built, reader.txCbor, 1_700_000_000_000);
}

describe('the stake key signer', () => {
  it('signs with 2/i only when the key hashes to the record\'s stake key', async () => {
    const witness = await signVaultRoleWithRootKey(owners[0].rootKey, ROLE.STAKE, owners[0].index, owners[0].stakeKeyHash, TX_ID);
    expect(witness.vkey).toBe(owners[0].keys.stake);
    await expect(signVaultRoleWithRootKey(owners[0].rootKey, ROLE.STAKE, owners[0].index, owners[0].credential, TX_ID)).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    await expect(signVaultRoleWithRootKey(owners[0].rootKey, ROLE.STAKE, owners[0].index + 1, owners[0].stakeKeyHash, TX_ID)).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    await expect(signVaultRoleWithRootKey(owners[0].rootKey, 1 as typeof ROLE.STAKE, owners[0].index, owners[0].stakeKeyHash, TX_ID)).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
  });
});

describe('the collateral key signer', () => {
  it('signs with the first address key of this wallet\'s own account, and nothing else', async () => {
    expect(await accountCollateralKeyHash(wallet.publicKey)).toBe(wallet.paymentKeyHash);
    const witness = await signCollateralWithRootKey(wallet.rootKey, wallet.accountIndex, wallet.publicKey, wallet.paymentKeyHash, TX_ID);
    expect(witness.vkey).toHaveLength(64);
    const other = await collateralWallet(3);
    // Another wallet's account key, or a collateral that is not the first address: refused.
    await expect(signCollateralWithRootKey(wallet.rootKey, wallet.accountIndex, other.publicKey, other.paymentKeyHash, TX_ID)).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    await expect(signCollateralWithRootKey(wallet.rootKey, wallet.accountIndex, wallet.publicKey, other.paymentKeyHash, TX_ID)).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    // The root of another wallet does not give this account's key.
    await expect(signCollateralWithRootKey(other.rootKey, wallet.accountIndex, wallet.publicKey, wallet.paymentKeyHash, TX_ID)).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    await expect(signCollateralWithRootKey(wallet.rootKey, 0, wallet.publicKey, wallet.paymentKeyHash, TX_ID)).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    expect(await accountCollateralKeyHash('not a key')).toBeUndefined();
  });
});

/** The background of owner `who`'s wallet; owner 0's wallet is the collateral wallet. */
function background(who: number) {
  let opened: Uint8Array | undefined;
  const walletRecord = {
    id: 40 + who, network: 'Preprod', type: WalletType.Normal, encryptionMethod: 'password' as const, encryptedPrivateKey: 'sealed',
    ...(who === 0 ? { publicKey: wallet.publicKey, accountIndex: wallet.accountIndex } : {}),
  };
  const deps: SignVaultBundleDeps = {
    wallet: () => walletRecord,
    verifyPassword: vi.fn(async (password: string) => password === 'right'),
    decryptRootKey: vi.fn(() => {
      opened = Uint8Array.from(owners[who].rootKey);
      return opened;
    }),
    getVault: vi.fn(async (_walletId: number, vaultId: string) => (vaultId === records[who].vaultId ? records[who] : undefined)),
    acceptedVaults: vi.fn(async () => [records[who]]),
    currentSlot: () => TIP + 30,
    collateralPercentage: () => COLLATERAL_PERCENTAGE,
    now: () => 1_700_000_005_000,
  };
  return { deps, walletRecord, opened: () => opened };
}

describe('signing an operation in the background', () => {
  it('signs a DUST registration with the payment and stake keys, and the proposer\'s collateral', async () => {
    const bundle = await bundleFor({ kind: 'dust_register', dustAddress: dustAddressOf('preprod', TEST_DUST_HEX) });
    const review = await reviewBundle(bundle, vault, { currentSlot: TIP, collateralPercentage: COLLATERAL_PERCENTAGE });
    if (review.status !== 'ready') throw new Error('refused');
    const plan = witnessPlanOf(review.operation, vault);

    const proposer = background(0);
    const own = await signVaultBundleFlow({ walletId: proposer.walletRecord.id, vaultId: records[0].vaultId, bundle, password: 'right' }, proposer.deps);
    expect(own.vkeyWitnesses.map(w => w.vkey).slice(0, 2)).toEqual([owners[0].keys.payment, owners[0].keys.stake]);
    expect(own.vkeyWitnesses).toHaveLength(3);
    const verified = await verifyWitnessFile(own, bundle, vault, plan);
    expect(verified.collateralWitness).toBeDefined();
    expect(proposer.opened()?.every(byte => byte === 0)).toBe(true);

    // Another owner's wallet holds no collateral here: payment and stake only.
    const cosigner = background(1);
    const theirs = await signVaultBundleFlow({ walletId: cosigner.walletRecord.id, vaultId: records[1].vaultId, bundle, password: 'right' }, cosigner.deps);
    expect(theirs.vkeyWitnesses.map(w => w.vkey)).toEqual([owners[1].keys.payment, owners[1].keys.stake]);
    expect((await verifyWitnessFile(theirs, bundle, vault, plan)).collateralWitness).toBeUndefined();
  });

  it('checks the collateral on the device before opening any key: no protocol percentage, no signature', async () => {
    const bundle = await bundleFor({ kind: 'dust_register', dustAddress: dustAddressOf('preprod', TEST_DUST_HEX) });
    const proposer = background(0);
    proposer.deps.collateralPercentage = () => null;
    await expect(signVaultBundleFlow({ walletId: proposer.walletRecord.id, vaultId: records[0].vaultId, bundle, password: 'right' }, proposer.deps))
      .rejects.toMatchObject({ code: 'bundle-refused', detail: 'collateral_shape' });
    expect(proposer.deps.decryptRootKey).not.toHaveBeenCalled();
  });

  it('signs a stake registration with the payment and stake keys only', async () => {
    const bundle = await bundleFor({ kind: 'stake_register' });
    const proposer = background(0);
    const file = await signVaultBundleFlow({ walletId: proposer.walletRecord.id, vaultId: records[0].vaultId, bundle, password: 'right' }, proposer.deps);
    expect(file.vkeyWitnesses.map(w => w.vkey)).toEqual([owners[0].keys.payment, owners[0].keys.stake]);
  });

  it('refuses a body the sheet refuses, before any key is opened', async () => {
    const bundle = await bundleFor({ kind: 'stake_register' });
    // Same bundle, but for a vault record whose network has no such tip: the sheet refuses it.
    const proposer = background(0);
    proposer.deps.currentSlot = () => null;
    await expect(signVaultBundleFlow({ walletId: proposer.walletRecord.id, vaultId: records[0].vaultId, bundle, password: 'right' }, proposer.deps))
      .rejects.toMatchObject({ code: 'bundle-refused' });
    expect(proposer.deps.decryptRootKey).not.toHaveBeenCalled();
  });
});
