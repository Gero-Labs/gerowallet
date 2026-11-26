// The approval sheet's rules for a vault spend, applied to hand-built bodies: what it shows for a
// plain spend, and what it refuses or warns about, each compared with this device's own record.
import { beforeAll, describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { SIGNING_FILE_VERSION, UNSIGNED_BUNDLE_TYPE, type UnsignedTxBundle } from '@/modules/gerovault/contracts';
import { bodyInputRefs } from './bundle';
import { reviewBundle, type SpendReview } from './review';
import { spendContextOf, vaultBaseAddress, type VaultSpendContext } from './vaultSpendContext';
import { fundingTransaction, lovelaceOutput, payeeAddress, testOwner, testVaultRecord, type FundingTx } from './__fixtures__/testVault';

const TIP = 10_000;
const TTL = TIP + 3600;

let vault: VaultSpendContext;
let otherVault: VaultSpendContext;
let funding: FundingTx;

beforeAll(async () => {
  const owners = [await testOwner(1), await testOwner(2), await testOwner(3)];
  vault = await spendContextOf(await testVaultRecord(owners, 2, 0));
  otherVault = await spendContextOf(await testVaultRecord(owners.slice(1), 2, 0, { name: 'Savings' }));
  funding = fundingTransaction([
    lovelaceOutput(vault.baseAddress, 20_000_000n),
    lovelaceOutput(vault.baseAddress, 10_000_000n),
    lovelaceOutput(payeeAddress('d4'), 10_000_000n),
  ]);
});

const input = (index: number): Cardano.TxIn => ({ txId: Cardano.TransactionId(funding.id), index });

function bundleOf(body: Partial<Cardano.TxBody>, sources: Record<string, string> = { [funding.id]: funding.cbor }): UnsignedTxBundle {
  const bodyCbor = Serialization.TransactionBody.fromCore({
    inputs: [input(0)],
    outputs: [],
    fee: 200_000n,
    validityInterval: { invalidHereafter: Cardano.Slot(TTL) },
    ...body,
  } as Cardano.TxBody).toCbor();
  return {
    type: UNSIGNED_BUNDLE_TYPE,
    version: SIGNING_FILE_VERSION,
    network: vault.network,
    vaultId: vault.vaultId,
    txId: Serialization.TransactionBody.fromCbor(HexBlob(bodyCbor)).hash(),
    bodyCbor,
    inputs: bodyInputRefs(bodyCbor),
    sourceTransactions: sources,
    createdAt: 0,
  };
}

/** 20 ADA in: `paid` to `to`, the fee, the rest back to the vault. */
function spend(to: string, paid: bigint, extra: Partial<Cardano.TxBody> = {}, fee = 200_000n): UnsignedTxBundle {
  return bundleOf({
    outputs: [lovelaceOutput(to, paid), lovelaceOutput(vault.baseAddress, 20_000_000n - paid - fee)],
    fee,
    ...extra,
  });
}

function codes(review: SpendReview): string[] {
  return review.status === 'refused' ? review.refusals.map(r => r.code) : [];
}

describe('the vault approval sheet', () => {
  it('shows a plain spend: the full destination, the amount, the fee and the change', async () => {
    const review = await reviewBundle(spend(payeeAddress(), 5_000_000n), vault, { currentSlot: TIP });
    if (review.status !== 'ready') throw new Error(JSON.stringify(review.refusals));
    expect(review.inputCount).toBe(1);
    expect(review.outputs.map(o => [o.kind, o.address])).toEqual([['external', payeeAddress()], ['change', vault.baseAddress]]);
    expect(review.leaves).toEqual({ lovelace: 5_200_000n, tokens: [] });
    expect(review.change).toEqual({ lovelace: 14_800_000n, tokens: [] });
    expect(review.fee).toBe(200_000n);
    expect(review.invalidHereafter).toBe(TTL);
    expect(review.warnings).toEqual([]);
  });

  it('refuses an input it cannot prove from the bundle', async () => {
    const review = await reviewBundle({ ...spend(payeeAddress(), 5_000_000n), sourceTransactions: {} }, vault, { currentSlot: TIP });
    expect(codes(review)).toContain('input_unresolved');
  });

  it('refuses an input that is not the vault\'s', async () => {
    const bundle = bundleOf({
      inputs: [input(0), input(2)],
      outputs: [lovelaceOutput(payeeAddress(), 29_800_000n)],
    });
    const review = await reviewBundle(bundle, vault, { currentSlot: TIP });
    expect(review.status === 'refused' && review.refusals).toEqual([{ code: 'input_not_vault', path: 'body.0[1]' }]);
  });

  it('refuses change that carries a datum or a reference script', async () => {
    const datum = bundleOf({
      outputs: [{ ...lovelaceOutput(vault.baseAddress, 19_800_000n), datumHash: Hash32ByteBase16('ab'.repeat(32)) }],
    });
    expect(codes(await reviewBundle(datum, vault, { currentSlot: TIP }))).toEqual(['vault_output_datum']);
    const inline = bundleOf({
      outputs: [{ ...lovelaceOutput(vault.baseAddress, 19_800_000n), datum: 42n as unknown as Cardano.PlutusData }],
    });
    expect(codes(await reviewBundle(inline, vault, { currentSlot: TIP }))).toEqual(['vault_output_datum']);
    const script = bundleOf({
      outputs: [{ ...lovelaceOutput(vault.baseAddress, 19_800_000n), scriptReference: vault.paymentScript }],
    });
    expect(codes(await reviewBundle(script, vault, { currentSlot: TIP }))).toEqual(['vault_output_script']);
  });

  it('shows an output to another accepted vault as moving there, and holds it to the same rule', async () => {
    const known = [{ vaultId: otherVault.vaultId, name: 'Savings', baseAddressHex: otherVault.baseAddressHex }];
    const review = await reviewBundle(spend(otherVault.baseAddress, 5_000_000n), vault, { currentSlot: TIP, knownVaults: known });
    expect(review.status === 'ready' && review.outputs[0]).toMatchObject({ kind: 'other_vault', vault: { vaultId: otherVault.vaultId, name: 'Savings' } });
    expect(review.status === 'ready' && review.leaves.lovelace).toBe(5_200_000n);
    const unknown = await reviewBundle(spend(otherVault.baseAddress, 5_000_000n), vault, { currentSlot: TIP });
    expect(unknown.status === 'ready' && unknown.outputs[0].kind).toBe('external');
  });

  it('shows the vault script under another stake key as leaving the vault, with a warning', async () => {
    const foreign = Cardano.BaseAddress.fromCredentials(
      Cardano.NetworkId.Testnet,
      { type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(vault.paymentScriptHash) },
      { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16('f1'.repeat(28)) },
    ).toAddress().toBech32();
    const review = await reviewBundle(spend(foreign, 5_000_000n), vault, { currentSlot: TIP });
    if (review.status !== 'ready') throw new Error('refused');
    expect(review.outputs[0].kind).toBe('vault_script_other_stake');
    expect(review.warnings).toEqual([{ code: 'vault_script_other_stake', output: 0 }]);
    expect(review.leaves.lovelace).toBe(5_200_000n);
  });

  it('warns about a fee above half an ADA and refuses one above two', async () => {
    const high = await reviewBundle(spend(payeeAddress(), 5_000_000n, {}, 600_000n), vault, { currentSlot: TIP });
    expect(high.status === 'ready' && high.warnings).toEqual([{ code: 'fee_high' }]);
    expect(codes(await reviewBundle(spend(payeeAddress(), 5_000_000n, {}, 2_000_001n), vault, { currentSlot: TIP }))).toContain('fee_above_limit');
  });

  it('refuses a transaction that never expires, has expired, or expires more than seven days out', async () => {
    expect(codes(await reviewBundle(spend(payeeAddress(), 5_000_000n, { validityInterval: {} }), vault, { currentSlot: TIP }))).toEqual(['no_expiry']);
    expect(codes(await reviewBundle(spend(payeeAddress(), 5_000_000n), vault, { currentSlot: TTL }))).toEqual(['expired']);
    expect(codes(await reviewBundle(spend(payeeAddress(), 5_000_000n), vault, { currentSlot: null }))).toEqual(['expired']);
    const far = { validityInterval: { invalidHereafter: Cardano.Slot(TIP + 7 * 24 * 3600 + 1) } };
    expect(codes(await reviewBundle(spend(payeeAddress(), 5_000_000n, far), vault, { currentSlot: TIP }))).toEqual(['expiry_too_far']);
  });

  it('refuses anything but a plain spend', async () => {
    const signers = { requiredExtraSignatures: [Ed25519KeyHashHex(vault.owners[0])] };
    expect(codes(await reviewBundle(spend(payeeAddress(), 5_000_000n, signers), vault, { currentSlot: TIP }))).toEqual(['not_a_plain_spend']);
  });

  it('refuses a bundle for another vault, and a body on another network', async () => {
    expect(codes(await reviewBundle(spend(payeeAddress(), 5_000_000n), otherVault, { currentSlot: TIP }))).toEqual(['bundle_other_vault']);
    const mainnetPayee = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Mainnet, {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16('a1'.repeat(28)),
    }).toAddress().toBech32();
    expect(codes(await reviewBundle(spend(mainnetPayee, 5_000_000n), vault, { currentSlot: TIP }))).toContain('network_mismatch');
  });

  it('derives the vault address it compares with from the scripts', () => {
    expect(vaultBaseAddress('preprod', vault.paymentScriptHash, vault.stakeScriptHash).hex).toBe(vault.baseAddressHex);
    expect(vault.baseAddress.startsWith('addr_test1')).toBe(true);
  });
});
