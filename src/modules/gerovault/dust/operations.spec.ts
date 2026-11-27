// Stake and DUST operations of a native vault, from the proposer's build to the assembled
// transaction: the shapes each builder writes, the sheet reading them back as named operations, the
// witness plan, the signatures (payment, stake and the collateral wallet's) and assembly with the
// stake script and exactly the stake threshold of stake witnesses. Keys are generated here.
import { beforeAll, describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { ROLE } from '@/shared/gerovault';
import type { UnsignedTxBundle, VaultRecord } from '@/modules/gerovault/contracts';
import { createUnsignedBundle } from '@/modules/gerovault/spend/bundle';
import { reviewBundle, type SpendReviewReady } from '@/modules/gerovault/spend/review';
import { signCollateralWithRootKey, signVaultRoleWithRootKey, signWithRootKey } from '@/modules/gerovault/spend/signer';
import { spendContextOf, type VaultSpendContext } from '@/modules/gerovault/spend/vaultSpendContext';
import {
  addSignature,
  assembleTransaction,
  createWitnessFile,
  emptyCollection,
  signingProgress,
  verifyWitnessFile,
  witnessKeyHashes,
  type SignatureCollection,
} from '@/modules/gerovault/spend/witnesses';
import {
  fundingTransaction,
  lovelaceOutput,
  testOwner,
  testReader,
  testVaultRecord,
  type FundingTx,
  type TestOwner,
} from '@/modules/gerovault/spend/__fixtures__/testVault';
import { buildVaultOperation, DUST_OPERATION_VALIDITY_SLOTS, type BuildOperationInput, type OperationRequest } from './buildOperation';
import { cnightAssetOf, dustAddressOf, mappingValidatorFor } from './mappingValidator';
import { witnessPlanOf, type WitnessPlan } from './operations';
import { plutusV3CostModel, scriptDataHashOf } from './scriptData';
import {
  OPERATION_PARAMS,
  TEST_DUST_HEX,
  collateralWallet,
  ownerOfWallet,
  registrationFunding,
  sharedCredentialVaultRecord,
  type CollateralWallet,
} from './__fixtures__/dustVault';

const TIP = 80_000_000;
const COST_MODEL = plutusV3CostModel(OPERATION_PARAMS.costModels)!;
const CNIGHT = Cardano.AssetId(`${cnightAssetOf('preprod')!.policyId}${cnightAssetOf('preprod')!.assetNameHex}`);
const DUST_ADDRESS = dustAddressOf('preprod', TEST_DUST_HEX);
const validator = mappingValidatorFor('preprod')!;

let wallet: CollateralWallet;
let owners: TestOwner[];
let record: VaultRecord;
let vault: VaultSpendContext;
let funding: FundingTx;
let walletFunding: FundingTx;

beforeAll(async () => {
  wallet = await collateralWallet();
  // Owner 1 proposes: their own wallet's first address holds the collateral.
  owners = [await ownerOfWallet(wallet, 1), await testOwner(2), await testOwner(3)];
  record = await testVaultRecord(owners, 2, 0);
  vault = await spendContextOf(record);
  funding = fundingTransaction([
    lovelaceOutput(vault.baseAddress, 20_000_000n),
    lovelaceOutput(vault.baseAddress, 2_000_000n, new Map([[CNIGHT, 1_000_000n]])),
  ]);
  walletFunding = fundingTransaction([lovelaceOutput(wallet.address, 10_000_000n)], 2);
});

const chain = (overrides: Partial<BuildOperationInput['chain']> = {}): BuildOperationInput['chain'] => ({ stakeRegistered: true, rewards: 0n, registrations: [], ...overrides });

async function propose(request: OperationRequest, options: { context?: VaultSpendContext; chainState?: BuildOperationInput['chain']; extra?: FundingTx[] } = {}) {
  const context = options.context ?? vault;
  const sources = [funding, walletFunding, ...(options.extra ?? [])];
  const { reader, submitted } = testReader(sources);
  const built = await buildVaultOperation({
    context,
    utxos: funding.utxos,
    request,
    chain: options.chainState ?? chain(),
    protocolParameters: OPERATION_PARAMS,
    currentSlot: TIP,
    collateral: { address: wallet.address, utxos: walletFunding.utxos },
  });
  const bundle = await createUnsignedBundle(context, built, reader.txCbor, 1_700_000_000_000);
  return { built, bundle, reader, submitted };
}

async function ready(bundle: UnsignedTxBundle, context: VaultSpendContext = vault): Promise<SpendReviewReady> {
  const review = await reviewBundle(bundle, context, { currentSlot: TIP });
  if (review.status !== 'ready') throw new Error(`refused: ${JSON.stringify(review.refusals)}`);
  return review;
}

/** Owner `who`'s witnesses on `bundle` for `plan`, as their background would sign them. */
async function sign(who: number, bundle: UnsignedTxBundle, plan: WitnessPlan, context: VaultSpendContext = vault, withCollateral = who === 0) {
  const owner = owners[who];
  const self = context.participants.find(p => p.credential === owner.credential)!;
  const witnesses = [await signWithRootKey(owner.rootKey, owner.index, owner.credential, bundle.txId)];
  if (plan.stake) witnesses.push(await signVaultRoleWithRootKey(owner.rootKey, ROLE.STAKE, owner.index, owner.stakeKeyHash, bundle.txId));
  if (withCollateral && plan.collateralPayer) {
    witnesses.push(await signCollateralWithRootKey(wallet.rootKey, wallet.accountIndex, wallet.publicKey, plan.collateralPayer, bundle.txId));
  }
  return createWitnessFile(bundle, self, witnesses);
}

async function collect(bundle: UnsignedTxBundle, plan: WitnessPlan, who: number[], context: VaultSpendContext = vault): Promise<SignatureCollection> {
  let collection = emptyCollection(bundle);
  for (const i of who) collection = addSignature(collection, await verifyWitnessFile(await sign(i, bundle, plan, context), bundle, context, plan)).collection;
  return collection;
}

const tx = (cbor: string) => Serialization.Transaction.fromCbor(cbor as Serialization.TxCBOR);

describe('registering the vault\'s stake credential', () => {
  it('builds the Conway registration with its deposit, paid from the vault, and the sheet names it', async () => {
    const { built, bundle } = await propose({ kind: 'stake_register' }, { chainState: chain({ stakeRegistered: false }) });
    const body = Serialization.TransactionBody.fromCbor(HexBlob(built.bodyCbor)).toCore();
    expect(body.certificates).toEqual([{ __typename: Cardano.CertificateType.Registration, stakeCredential: { type: Cardano.CredentialType.ScriptHash, hash: vault.stakeScriptHash }, deposit: 2_000_000n }]);
    expect(body.withdrawals).toBeUndefined();
    expect(body.collaterals).toBeUndefined();
    expect(body.outputs.every(output => output.address === vault.baseAddress)).toBe(true);
    // The cNIGHT UTxO is left alone: spending it would restart its DUST generation.
    expect(built.inputs).toEqual([{ txId: funding.id, index: 0 }]);

    const review = await ready(bundle);
    expect(review.operation).toEqual({ kind: 'stake_register', depositLovelace: 2_000_000n });
    expect(witnessPlanOf(review.operation, vault)).toEqual({ stake: true, stakeScript: true, plutus: false, collateralPayer: null });
  });

  it('is never built twice', async () => {
    await expect(propose({ kind: 'stake_register' }, { chainState: chain({ stakeRegistered: true }) })).rejects.toMatchObject({ code: 'STAKE_ALREADY_REGISTERED' });
  });

  it('assembles with both scripts and exactly the threshold of payment and stake witnesses', async () => {
    const { bundle } = await propose({ kind: 'stake_register' }, { chainState: chain({ stakeRegistered: false }) });
    const review = await ready(bundle);
    const plan = witnessPlanOf(review.operation, vault);
    const collection = await collect(bundle, plan, [1, 2, 0]);
    const signed = assembleTransaction(bundle, vault, collection, { review });
    const witness = tx(signed).witnessSet();
    expect(witness.nativeScripts()!.toCore().map(s => Serialization.NativeScript.fromCore(s).hash())).toEqual([vault.paymentScriptHash, vault.stakeScriptHash]);
    const hashes = await witnessKeyHashes(signed);
    expect(hashes.filter(h => vault.owners.includes(h))).toHaveLength(2);
    expect(hashes.filter(h => vault.stakeOwners.includes(h))).toHaveLength(2);
    expect(hashes).toHaveLength(4);
    expect(witness.redeemers()).toBeUndefined();
    expect(String(tx(signed).getId())).toBe(bundle.txId);
  });
});

describe('registering DUST generation', () => {
  it('writes the experiment\'s shape: one token, the datum naming the vault\'s stake script, the zero withdrawal, collateral', async () => {
    const { built, bundle } = await propose({ kind: 'dust_register', dustAddress: DUST_ADDRESS });
    const body = Serialization.TransactionBody.fromCbor(HexBlob(built.bodyCbor));
    const core = body.toCore();
    expect(core.mint).toEqual(new Map([[Cardano.AssetId(validator.scriptHash), 1n]]));
    expect(core.withdrawals).toEqual([{ stakeAddress: vault.rewardAccount, quantity: 0n }]);
    const registration = body.outputs()[0];
    expect(registration.address().toBech32()).toBe(validator.address);
    expect(registration.datum()!.asInlineData()!.toCbor()).toBe(`d8799fd87a9f581c${vault.stakeScriptHash}ff5821${TEST_DUST_HEX}ff`);
    expect(core.collaterals).toEqual([{ txId: walletFunding.id, index: 0 }]);
    expect(core.collateralReturn?.address).toBe(wallet.address);
    expect(core.totalCollateral).toBe((built.fee * 150n + 99n) / 100n);
    expect(core.validityInterval?.invalidHereafter).toBe(TIP + DUST_OPERATION_VALIDITY_SLOTS);

    const review = await ready(bundle);
    expect(review.operation).toMatchObject({ kind: 'dust_register', dustAddress: DUST_ADDRESS, withdrawalLovelace: 0n, registrationOutput: 0 });
    expect(review.outputs.map(o => o.kind)).toEqual(['dust_registration', 'change']);
    expect(review.operation?.kind === 'dust_register' && review.operation.collateral.payer.hash).toBe(wallet.paymentKeyHash);
    expect(review.summary.scriptDataHash).toBe(core.scriptIntegrityHash);
  });

  it('refuses a second registration for the same stake credential, and one before the stake registration', async () => {
    const existing = registrationFunding(vault.stakeScriptHash);
    await expect(propose({ kind: 'dust_register', dustAddress: DUST_ADDRESS }, { chainState: chain({ registrations: existing.utxos }) }))
      .rejects.toMatchObject({ code: 'DUST_ALREADY_REGISTERED' });
    await expect(propose({ kind: 'dust_register', dustAddress: DUST_ADDRESS }, { chainState: chain({ stakeRegistered: false }) }))
      .rejects.toMatchObject({ code: 'STAKE_NOT_REGISTERED' });
  });

  it('refuses a DUST address of another network, and a wallet with no ADA-only UTxO for collateral', async () => {
    await expect(propose({ kind: 'dust_register', dustAddress: dustAddressOf('preview', TEST_DUST_HEX) })).rejects.toMatchObject({ code: 'INVALID_DUST_ADDRESS' });
    const { reader } = testReader([funding]);
    await expect(buildVaultOperation({
      context: vault,
      utxos: await reader.utxos(vault.baseAddress),
      request: { kind: 'dust_register', dustAddress: DUST_ADDRESS },
      chain: chain(),
      protocolParameters: OPERATION_PARAMS,
      currentSlot: TIP,
      collateral: { address: wallet.address, utxos: [] },
    })).rejects.toMatchObject({ code: 'NO_COLLATERAL' });
  });

  it('is signed by the payment and stake keys of each owner, and by the proposer\'s wallet for the collateral', async () => {
    const { bundle } = await propose({ kind: 'dust_register', dustAddress: DUST_ADDRESS });
    const review = await ready(bundle);
    const plan = witnessPlanOf(review.operation, vault);
    expect(plan).toEqual({ stake: true, stakeScript: true, plutus: true, collateralPayer: wallet.paymentKeyHash });

    // A cosigner's file without the stake witness does not count.
    const self = vault.participants[1];
    const paymentOnly = createWitnessFile(bundle, self, [await signWithRootKey(owners[1].rootKey, owners[1].index, owners[1].credential, bundle.txId)]);
    await expect(verifyWitnessFile(paymentOnly, bundle, vault, plan)).rejects.toMatchObject({ detail: 'stake_missing' });

    // Without the collateral wallet's witness the transaction is not complete.
    const withoutCollateral = await collect(bundle, plan, [1, 2]);
    expect(signingProgress(withoutCollateral, vault, plan)).toMatchObject({ collected: 2, complete: false, collateralSigned: false });
    expect(() => assembleTransaction(bundle, vault, withoutCollateral, { review, plutusV3CostModel: COST_MODEL })).toThrow(expect.objectContaining({ code: 'NOT_AT_THRESHOLD' }));

    const collection = await collect(bundle, plan, [1, 0]);
    expect(signingProgress(collection, vault, plan)).toMatchObject({ collected: 2, complete: true, collateralSigned: true });
    const signed = assembleTransaction(bundle, vault, collection, { review, plutusV3CostModel: COST_MODEL });
    const witness = tx(signed).witnessSet();
    expect(witness.plutusV3Scripts()!.toCore().map(s => String(s.bytes))).toEqual([validator.scriptCbor]);
    expect(witness.nativeScripts()!.size()).toBe(2);
    const hashes = await witnessKeyHashes(signed);
    expect(hashes.filter(h => vault.owners.includes(h))).toHaveLength(2);
    expect(hashes.filter(h => vault.stakeOwners.includes(h))).toHaveLength(2);
    expect(hashes).toContain(wallet.paymentKeyHash);
    expect(hashes).toHaveLength(5);
    // The script data hash in the body covers exactly the redeemers in the witness set.
    expect(scriptDataHashOf(witness.redeemers()!.toCbor(), COST_MODEL)).toBe(review.summary.scriptDataHash);
    expect(String(tx(signed).getId())).toBe(bundle.txId);
    // The fee the proposer sized covers the transaction as submitted.
    const size = BigInt(signed.length / 2);
    const scriptFee = BigInt(Math.ceil(250_000 * 0.0577 + 100_000_000 * 0.0000721));
    expect(review.fee).toBeGreaterThanOrEqual(size * 44n + 155_381n + scriptFee);
  });

  it('is not assembled with another cost model than the one the body commits to', async () => {
    const { bundle } = await propose({ kind: 'dust_register', dustAddress: DUST_ADDRESS });
    const review = await ready(bundle);
    const collection = await collect(bundle, witnessPlanOf(review.operation, vault), [1, 0]);
    expect(() => assembleTransaction(bundle, vault, collection, { review, plutusV3CostModel: COST_MODEL.map((n, i) => (i === 0 ? n + 1 : n)) }))
      .toThrow(expect.objectContaining({ code: 'SCRIPT_DATA_MISMATCH' }));
    expect(() => assembleTransaction(bundle, vault, collection, { review })).toThrow(expect.objectContaining({ code: 'SCRIPT_DATA_MISMATCH' }));
  });
});

describe('deregistering DUST, and the stake credential with it', () => {
  it('spends the registration and burns its token; the sheet shows the DUST address it stops', async () => {
    const registration = registrationFunding(vault.stakeScriptHash);
    const { built, bundle } = await propose({ kind: 'dust_deregister', deregisterStake: false }, { chainState: chain({ registrations: registration.utxos }), extra: [registration] });
    const core = Serialization.TransactionBody.fromCbor(HexBlob(built.bodyCbor)).toCore();
    expect(core.mint).toEqual(new Map([[Cardano.AssetId(validator.scriptHash), -1n]]));
    expect(core.inputs).toContainEqual({ txId: registration.id, index: 0 });
    expect(core.certificates).toBeUndefined();
    const review = await ready(bundle);
    expect(review.operation).toMatchObject({ kind: 'dust_deregister', dustAddress: DUST_ADDRESS, releasedLovelace: 1_353_340n, stakeRefundLovelace: null });

    const collection = await collect(bundle, witnessPlanOf(review.operation, vault), [0, 2]);
    const signed = assembleTransaction(bundle, vault, collection, { review, plutusV3CostModel: COST_MODEL });
    const redeemers = tx(signed).witnessSet().redeemers()!.toCore();
    expect(redeemers.map(r => r.purpose).sort()).toEqual([Cardano.RedeemerPurpose.mint, Cardano.RedeemerPurpose.spend]);
    const sorted = [...core.inputs].sort((a, b) => (a.txId < b.txId ? -1 : a.txId > b.txId ? 1 : a.index - b.index));
    expect(redeemers.find(r => r.purpose === Cardano.RedeemerPurpose.spend)!.index).toBe(sorted.findIndex(i => i.txId === registration.id));
  });

  it('can deregister the stake credential in the same transaction, returning the deposit to the vault', async () => {
    const registration = registrationFunding(vault.stakeScriptHash);
    const { bundle } = await propose({ kind: 'dust_deregister', deregisterStake: true }, { chainState: chain({ registrations: registration.utxos }), extra: [registration] });
    const review = await ready(bundle);
    expect(review.operation).toMatchObject({ kind: 'dust_deregister', stakeRefundLovelace: 2_000_000n });
    expect(review.outputs.every(o => o.kind === 'change')).toBe(true);
  });

  it('refuses to deregister the stake credential alone while a DUST registration needs its withdrawal', async () => {
    const registration = registrationFunding(vault.stakeScriptHash);
    await expect(propose({ kind: 'stake_deregister' }, { chainState: chain({ registrations: registration.utxos }) })).rejects.toMatchObject({ code: 'DUST_ALREADY_REGISTERED' });
    await expect(propose({ kind: 'dust_deregister', deregisterStake: false })).rejects.toMatchObject({ code: 'DUST_NOT_REGISTERED' });
  });

  it('deregisters the stake credential alone once DUST is gone', async () => {
    const { bundle } = await propose({ kind: 'stake_deregister' }, { chainState: chain({ rewards: 1_234n }) });
    const review = await ready(bundle);
    expect(review.operation).toEqual({ kind: 'stake_deregister', refundLovelace: 2_000_000n, withdrawalLovelace: 1_234n });
  });
});

describe('an imported vault whose stake credential is its payment script', () => {
  let shared: VaultSpendContext;
  beforeAll(async () => {
    shared = await spendContextOf(await sharedCredentialVaultRecord(owners, 2, 0));
  });

  it('reads as one script for both credentials', () => {
    expect(shared.sharedStakeCredential).toBe(true);
    expect(shared.stakeScriptHash).toBe(shared.paymentScriptHash);
    expect(shared.stakeOwners).toEqual(shared.owners);
  });

  it('registers DUST with the payment keys alone and the one script', async () => {
    const sharedFunding = fundingTransaction([lovelaceOutput(shared.baseAddress, 20_000_000n)], 9);
    const { reader } = testReader([sharedFunding, walletFunding]);
    const built = await buildVaultOperation({
      context: shared,
      utxos: sharedFunding.utxos,
      request: { kind: 'dust_register', dustAddress: DUST_ADDRESS },
      chain: chain(),
      protocolParameters: OPERATION_PARAMS,
      currentSlot: TIP,
      collateral: { address: wallet.address, utxos: walletFunding.utxos },
    });
    const bundle = await createUnsignedBundle(shared, built, reader.txCbor);
    const review = await ready(bundle, shared);
    expect(review.operation).toMatchObject({ kind: 'dust_register', dustAddress: DUST_ADDRESS });
    expect(review.summary.withdrawals[0].rewardAccount.credential).toEqual({ kind: 'script', hash: shared.paymentScriptHash });
    const plan = witnessPlanOf(review.operation, shared);
    expect(plan).toEqual({ stake: false, stakeScript: false, plutus: true, collateralPayer: wallet.paymentKeyHash });

    const collection = await collect(bundle, plan, [0, 1], shared);
    const signed = assembleTransaction(bundle, shared, collection, { review, plutusV3CostModel: COST_MODEL });
    expect(tx(signed).witnessSet().nativeScripts()!.size()).toBe(1);
    const hashes = await witnessKeyHashes(signed);
    expect(hashes).toHaveLength(3);
    expect(hashes.filter(h => shared.owners.includes(h))).toHaveLength(2);
  });
});
