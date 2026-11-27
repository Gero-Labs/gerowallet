// The approval sheet holds a stake or DUST operation to exactly the shapes the wallet builds. Each
// case changes one thing in a body the builder wrote and checks the sheet refuses it by name.
import { beforeAll, describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { createUnsignedBundle } from '@/modules/gerovault/spend/bundle';
import { reviewBundle, type SpendReview } from '@/modules/gerovault/spend/review';
import { spendContextOf, type VaultSpendContext } from '@/modules/gerovault/spend/vaultSpendContext';
import { fundingTransaction, lovelaceOutput, payeeAddress, testOwner, testReader, testVaultRecord, type FundingTx } from '@/modules/gerovault/spend/__fixtures__/testVault';
import { buildVaultOperation, type OperationRequest } from './buildOperation';
import { dustAddressOf, mappingValidatorFor } from './mappingValidator';
import { OPERATION_PARAMS, TEST_DUST_HEX, collateralWallet, registrationFunding, type CollateralWallet } from './__fixtures__/dustVault';

const TIP = 80_000_000;
const validator = mappingValidatorFor('preprod')!;
const TOKEN = Cardano.AssetId(validator.scriptHash);
const OTHER_HASH = 'ab'.repeat(28);

let vault: VaultSpendContext;
let wallet: CollateralWallet;
let funding: FundingTx;
let walletFunding: FundingTx;
let registration: FundingTx;

beforeAll(async () => {
  const owners = [await testOwner(1), await testOwner(2), await testOwner(3)];
  vault = await spendContextOf(await testVaultRecord(owners, 2, 0));
  wallet = await collateralWallet();
  funding = fundingTransaction([lovelaceOutput(vault.baseAddress, 30_000_000n)]);
  walletFunding = fundingTransaction([lovelaceOutput(wallet.address, 10_000_000n)], 2);
  registration = registrationFunding(vault.stakeScriptHash);
});

async function built(request: OperationRequest, registered = true) {
  return buildVaultOperation({
    context: vault,
    utxos: funding.utxos,
    request,
    chain: { stakeRegistered: registered, rewards: 0n, registrations: request.kind === 'dust_deregister' ? registration.utxos : [] },
    protocolParameters: OPERATION_PARAMS,
    currentSlot: TIP,
    collateral: { address: wallet.address, utxos: walletFunding.utxos },
  });
}

/**
 * The sheet of `body` after `change` edits its core and, optionally, its outputs. The change output
 * (the last output at the vault's address) is then set to what balances the body again, so each
 * case is refused for its own reason and not for the balance.
 */
async function sheetOf(
  bodyCbor: string,
  change: (core: Cardano.TxBody, outputs: Serialization.TransactionOutput[]) => Serialization.TransactionOutput[] | void,
  extra: FundingTx[] = [],
): Promise<SpendReview> {
  const body = Serialization.TransactionBody.fromCbor(HexBlob(bodyCbor));
  const core = body.toCore();
  const outputs = [...body.outputs()];
  const changed = change(core, outputs);
  const nextOutputs = [...(changed || outputs)];
  const known = [funding, walletFunding, registration, ...extra].flatMap(f => f.utxos);
  let lovelace = 0n;
  const tokens = new Map<Cardano.AssetId, bigint>();
  const add = (value: Cardano.Value, sign: bigint) => {
    lovelace += sign * BigInt(value.coins);
    for (const [id, q] of value.assets ?? []) tokens.set(id, (tokens.get(id) ?? 0n) + sign * BigInt(q));
  };
  for (const input of core.inputs) {
    const utxo = known.find(([ref]) => ref.txId === input.txId && ref.index === input.index);
    if (utxo) add(utxo[1].value, 1n);
  }
  for (const w of core.withdrawals ?? []) lovelace += w.quantity;
  for (const [id, q] of core.mint ?? []) tokens.set(id, (tokens.get(id) ?? 0n) + q);
  for (const cert of core.certificates ?? []) {
    if (cert.__typename === Cardano.CertificateType.Registration) lovelace -= cert.deposit;
    if (cert.__typename === Cardano.CertificateType.Unregistration) lovelace += cert.deposit;
  }
  lovelace -= core.fee;
  const changeAt = nextOutputs.map(o => o.address().toBech32()).lastIndexOf(vault.baseAddress);
  nextOutputs.forEach((output, i) => { if (i !== changeAt) add(output.toCore().value, -1n); });
  if (changeAt >= 0) {
    nextOutputs[changeAt] = Serialization.TransactionOutput.fromCore({
      address: Cardano.PaymentAddress(vault.baseAddress),
      value: { coins: lovelace, assets: new Map([...tokens].filter(([, q]) => q !== 0n)) },
    });
  }
  const next = Serialization.TransactionBody.fromCore(core);
  next.setOutputs(nextOutputs);
  const cbor = next.toCbor();
  const { reader } = testReader([funding, walletFunding, registration, ...extra]);
  const bundle = await createUnsignedBundle(vault, { bodyCbor: cbor, txId: Serialization.TransactionBody.fromCbor(HexBlob(cbor)).hash() }, reader.txCbor);
  return reviewBundle(bundle, vault, { currentSlot: TIP });
}

const codes = (review: SpendReview) => (review.status === 'refused' ? review.refusals.map(r => r.code) : ['ready']);

function registrationOutput(datumCbor: string): Serialization.TransactionOutput {
  const output = Serialization.TransactionOutput.fromCore({
    address: Cardano.PaymentAddress(validator.address),
    value: { coins: 1_400_000n, assets: new Map([[TOKEN, 1n]]) },
  });
  output.setDatum(Serialization.Datum.newInlineData(Serialization.PlutusData.fromCbor(HexBlob(datumCbor))));
  return output;
}

describe('the sheet of a DUST registration refuses', () => {
  let body: string;
  beforeAll(async () => {
    body = (await built({ kind: 'dust_register', dustAddress: dustAddressOf('preprod', TEST_DUST_HEX) })).bodyCbor;
  });

  it('nothing in the body as built', async () => {
    expect(codes(await sheetOf(body, () => undefined))).toEqual(['ready']);
  });

  it('a datum naming another stake credential', async () => {
    const review = await sheetOf(body, (_, outputs) => [registrationOutput(`d8799fd87a9f581c${OTHER_HASH}ff5821${TEST_DUST_HEX}ff`), outputs[1]]);
    expect(codes(review)).toContain('operation_other_credential');
  });

  it('a key credential datum, or a registration output under a stake part', async () => {
    const key = await sheetOf(body, (_, outputs) => [registrationOutput(`d8799fd8799f581c${vault.stakeScriptHash}ff5821${TEST_DUST_HEX}ff`), outputs[1]]);
    expect(codes(key)).toContain('registration_output_invalid');
    // The validator finds its output by payment credential; the wallet writes only its enterprise address.
    const staked = Cardano.BaseAddress.fromCredentials(
      Cardano.NetworkId.Testnet,
      { type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(validator.scriptHash) },
      { type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(vault.stakeScriptHash) },
    ).toAddress().toBech32();
    const elsewhere = await sheetOf(body, (_, outputs) => {
      const moved = registrationOutput(`d8799fd87a9f581c${vault.stakeScriptHash}ff5821${TEST_DUST_HEX}ff`);
      const core = moved.toCore();
      const out = Serialization.TransactionOutput.fromCore({ ...core, datum: undefined, address: Cardano.PaymentAddress(staked) });
      out.setDatum(moved.datum()!);
      return [out, outputs[1]];
    });
    expect(codes(elsewhere)).toContain('registration_output_invalid');
  });

  it('an output that pays anyone but the vault', async () => {
    const review = await sheetOf(body, (_, outputs) => {
      const change = outputs[1].toCore();
      return [outputs[0], Serialization.TransactionOutput.fromCore({ ...change, value: { coins: change.value.coins - 2_000_000n } }),
        Serialization.TransactionOutput.fromCore(lovelaceOutput(payeeAddress(), 2_000_000n))];
    });
    expect(codes(review)).toEqual(['operation_output']);
  });

  it('no withdrawal, or a withdrawal from another reward account', async () => {
    expect(codes(await sheetOf(body, core => { delete core.withdrawals; }))).toContain('operation_unknown');
    const other = Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Testnet, { type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(OTHER_HASH) }).toAddress().toBech32();
    expect(codes(await sheetOf(body, core => { core.withdrawals = [{ stakeAddress: Cardano.RewardAccount(other), quantity: 0n }]; })))
      .toContain('operation_other_credential');
  });

  it('a mint of another policy, or of more than one token', async () => {
    expect(codes(await sheetOf(body, core => { core.mint = new Map([[TOKEN, 1n], [Cardano.AssetId(OTHER_HASH), 1n]]); }))).toContain('mint_unsupported');
    expect(codes(await sheetOf(body, core => { core.mint = new Map([[TOKEN, 2n]]); }))).toContain('operation_unknown');
  });

  it('no collateral, a collateral return to someone else, and no script data hash', async () => {
    expect(codes(await sheetOf(body, core => {
      delete core.collaterals;
      delete core.collateralReturn;
      delete core.totalCollateral;
    }))).toContain('collateral_shape');
    expect(codes(await sheetOf(body, core => { core.collateralReturn = { ...core.collateralReturn!, address: Cardano.PaymentAddress(payeeAddress()) }; })))
      .toContain('collateral_shape');
    expect(codes(await sheetOf(body, core => { delete core.scriptIntegrityHash; }))).toContain('script_data_hash_shape');
  });

  it('more inputs than the declared script budgets are sized for', async () => {
    const many = fundingTransaction(Array.from({ length: 9 }, () => lovelaceOutput(vault.baseAddress, 2_000_000n)), 21);
    const review = await sheetOf(body, core => {
      core.inputs = [...core.inputs, ...many.utxos.map(([input]) => ({ txId: input.txId, index: input.index }))];
    }, [many]);
    expect(review.status === 'refused' && review.refusals.find(r => r.code === 'operation_unknown')?.detail).toBe('too_many_inputs');
  });

  it('a certificate beside the registration, and required signers', async () => {
    const stakeCredential = { type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(vault.stakeScriptHash) };
    expect(codes(await sheetOf(body, core => {
      core.certificates = [{ __typename: Cardano.CertificateType.Unregistration, stakeCredential, deposit: 2_000_000n }];
    }))).toContain('operation_unknown');
    expect(codes(await sheetOf(body, core => { core.requiredExtraSignatures = [vault.owners[0] as Ed25519KeyHashHex]; }))).toContain('not_a_plain_spend');
  });
});

describe('the sheet of a stake operation refuses', () => {
  let body: string;
  beforeAll(async () => {
    body = (await built({ kind: 'stake_register' }, false)).bodyCbor;
  });

  it('a registration of another credential, the pre-Conway certificate, and a delegation', async () => {
    const other = { type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(OTHER_HASH) };
    expect(codes(await sheetOf(body, core => { core.certificates = [{ __typename: Cardano.CertificateType.Registration, stakeCredential: other, deposit: 2_000_000n }]; })))
      .toContain('operation_other_credential');
    const own = { type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(vault.stakeScriptHash) };
    // The Shelley form states no deposit; without the protocol's, the decoder already refuses it.
    expect(codes(await sheetOf(body, core => { core.certificates = [{ __typename: Cardano.CertificateType.StakeRegistration, stakeCredential: own }]; })))
      .not.toEqual(['ready']);
    expect(codes(await sheetOf(body, core => {
      core.certificates = [{ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential: own, poolId: Cardano.PoolId.fromKeyHash(OTHER_HASH as Ed25519KeyHashHex) }];
    }))).toContain('operation_unknown');
  });

  it('collateral or a script data hash where no script runs', async () => {
    expect(codes(await sheetOf(body, core => { core.scriptIntegrityHash = Hash32ByteBase16('cd'.repeat(32)); }))).not.toEqual(['ready']);
  });
});

describe('the sheet of a DUST deregistration refuses', () => {
  it('spending a registration that names another credential', async () => {
    const other = registrationFunding(OTHER_HASH, TEST_DUST_HEX, 1_353_340n, 11);
    const body = (await built({ kind: 'dust_deregister', deregisterStake: false })).bodyCbor;
    const review = await sheetOf(body, core => {
      core.inputs = core.inputs.map(input => (input.txId === registration.id ? { txId: Cardano.TransactionId(other.id), index: 0 } : input));
    }, [other]);
    expect(codes(review)).toContain('operation_other_credential');
  });
});
