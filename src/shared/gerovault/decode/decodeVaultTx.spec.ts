import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { blake2b } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { OUTPUT_DATUM, OUTPUT_SCRIPT } from '@/shared/utils/__fixtures__/handAssembledTxs';
import { decodeVaultTransaction, type DecodeVaultTxOptions, type VaultTxDecodeResult, type VaultTxSummary } from './decodeVaultTx';
import type { Refusal } from './refusals';
import {
  array, baseEntries, bytes, BYRON_ADDRESS, coinAnd, CONWAY_DELEGATION_TX, CONWAY_DEREGISTRATION_TX, entry,
  EXECUTOR_ADDRESS, EXECUTOR_ENTERPRISE_ADDRESS, FOREIGN_STAKE_CHANGE_TX, FUND_TX, FUND_TX_ID, fundSource, GOLD, inputSet,
  K1, K2, legacyOutput, MANY_TOKEN_NAMES, MANY_TOKENS_TX, map, NFT, PAYEE_ADDRESS, PAYEE_MAINNET_ADDRESS, payingTo,
  PAYMENT_TX, POINTER_ADDRESS, POLICY_1, POLICY_2, POLICY_MANY, POOL_KEY_HASH, postAlonzoOutput, REFERENCE_INPUT_TX,
  REGISTRATION_DELEGATION_TX, SCRIPT_ENTERPRISE_ADDRESS, SCRIPT_OUTPUTS_TX, SHELLEY_DELEGATION_TX,
  SHELLEY_DEREGISTRATION_TX, transaction, uint, VAULT_ADDRESS, VAULT_FOREIGN_STAKE_ADDRESS, VAULT_REWARD_ACCOUNT,
  VAULT_SCRIPT_HASH, WITHDRAWAL_TX,
} from './__fixtures__/vaultTxs';

const bech32 = (hex: string) => Cardano.Address.fromBytes(HexBlob(hex)).toBech32();
const idOf = (txHex: string) => String(Serialization.Transaction.fromCbor(HexBlob(txHex) as Serialization.TxCBOR).getId());

const options = (over: Partial<DecodeVaultTxOptions> = {}): DecodeVaultTxOptions => ({
  networkId: 0,
  inputSources: [fundSource()],
  stakeKeyDepositLovelace: 2_000_000n,
  ...over,
});

async function summary(tx: string, over: Partial<DecodeVaultTxOptions> = {}): Promise<VaultTxSummary> {
  const result = await decodeVaultTransaction(tx, options(over));
  if (result.status !== 'decoded') throw new Error(`refused: ${JSON.stringify(result.refusals)}`);
  return result.summary;
}

async function refusals(tx: string | Uint8Array, over: Partial<DecodeVaultTxOptions> = {}): Promise<Refusal[]> {
  const result: VaultTxDecodeResult = await decodeVaultTransaction(tx, options(over));
  if (result.status === 'decoded') throw new Error('decoded, expected a refusal');
  expect(result).not.toHaveProperty('summary');
  return result.refusals;
}

/** The base shape (balanced) plus `extra` body entries. */
const withEntries = (...extra: Array<[string, string]>) => transaction(...baseEntries(), ...extra);

describe('fixtures', () => {
  it('FUND_TX_ID is the hash of FUND_TX', () => {
    expect(idOf(FUND_TX)).toBe(FUND_TX_ID);
  });
});

describe('decodeVaultTransaction: decoded transactions', () => {
  it('a payment: proven inputs, full addresses, every token, fee, validity, signers, network id', async () => {
    const s = await summary(PAYMENT_TX);
    expect(s.txId).toBe(idOf(PAYMENT_TX));
    expect(s.networkId).toBe(0);
    expect(s.bodyNetworkId).toBe(0);
    expect(s.inputs.map((i) => [i.txId, i.index])).toEqual([[FUND_TX_ID, 0], [FUND_TX_ID, 1]]);
    expect(s.inputs[0].output.value).toEqual({ lovelace: 100_000_000n, tokens: [] });
    expect(s.inputs[1].output.value.tokens).toEqual([
      { policyId: POLICY_1, assetNameHex: GOLD, quantity: 500n },
      { policyId: POLICY_1, assetNameHex: '', quantity: 1n },
      { policyId: POLICY_2, assetNameHex: NFT, quantity: 1n },
    ]);
    expect(s.outputs).toHaveLength(2);
    const [payee, change] = s.outputs;
    expect(payee.address.bech32).toBe(bech32(PAYEE_ADDRESS));
    expect(payee.address).toMatchObject({ kind: 'base', payment: { kind: 'key', hash: 'a1'.repeat(28) }, stake: { kind: 'key', hash: 'a2'.repeat(28) } });
    expect(payee.value).toEqual({ lovelace: 20_000_000n, tokens: [{ policyId: POLICY_1, assetNameHex: GOLD, quantity: 200n }] });
    expect(payee.datum).toBeNull();
    expect(payee.referenceScript).toBeNull();
    expect(change.address.bech32).toBe(bech32(VAULT_ADDRESS));
    expect(change.address.payment).toEqual({ kind: 'script', hash: VAULT_SCRIPT_HASH });
    expect(change.address.stake).toEqual({ kind: 'script', hash: VAULT_SCRIPT_HASH });
    expect(change.value.lovelace).toBe(89_800_000n);
    expect(change.value.tokens).toHaveLength(3);
    expect(s.fee).toBe(200_000n);
    expect(s.validity).toEqual({ invalidBefore: 900_000n, invalidHereafter: 1_000_000n });
    expect(s.requiredSigners).toEqual([K1, K2]);
    expect(s.withdrawals).toEqual([]);
    expect(s.certificates).toEqual([]);
    expect(s.collateral).toBeNull();
    expect(s.referenceInputs).toEqual([]);
  });

  it('the full bech32 address is never shortened', async () => {
    const s = await summary(PAYMENT_TX);
    for (const output of s.outputs) {
      expect(output.address.bech32).not.toContain('…');
      expect(output.address.bech32).not.toContain('...');
      expect(Cardano.Address.fromBech32(output.address.bech32).toBytes()).toBe(output.address.hex);
    }
  });

  it('a reward withdrawal: amount and the full reward address', async () => {
    const s = await summary(WITHDRAWAL_TX);
    expect(s.withdrawals).toEqual([{
      rewardAccount: { bech32: bech32(VAULT_REWARD_ACCOUNT), hex: VAULT_REWARD_ACCOUNT, networkId: 0, credential: { kind: 'script', hash: VAULT_SCRIPT_HASH } },
      lovelace: 1_500_000n,
    }]);
    expect(s.withdrawals[0].rewardAccount.bech32.startsWith('stake_test1')).toBe(true);
  });

  it('a Conway registration and pool delegation, with the deposit paid', async () => {
    const s = await summary(CONWAY_DELEGATION_TX);
    const credential = { kind: 'script', hash: VAULT_SCRIPT_HASH };
    expect(s.certificates).toEqual([
      { kind: 'stake_registration', form: 'conway', credential, deposit: { lovelace: 2_000_000n, source: 'body' } },
      { kind: 'stake_delegation', credential, pool: { keyHash: POOL_KEY_HASH, poolId: String(Cardano.PoolId.fromKeyHash(POOL_KEY_HASH as never)) } },
    ]);
    expect(s.certificates[1]).toMatchObject({ pool: { poolId: expect.stringMatching(/^pool1/) } });
    expect(s.deposits).toEqual({ paidLovelace: 2_000_000n, refundedLovelace: 0n });
  });

  it('the combined Conway registration with delegation', async () => {
    const s = await summary(REGISTRATION_DELEGATION_TX);
    expect(s.certificates).toEqual([expect.objectContaining({
      kind: 'stake_registration_delegation',
      pool: expect.objectContaining({ keyHash: POOL_KEY_HASH }),
      deposit: { lovelace: 2_000_000n, source: 'body' },
    })]);
    expect(s.deposits.paidLovelace).toBe(2_000_000n);
  });

  it('a Shelley registration (set under tag 258) pays the protocol deposit', async () => {
    const s = await summary(SHELLEY_DELEGATION_TX);
    expect(s.certificates[0]).toMatchObject({ kind: 'stake_registration', form: 'shelley', deposit: { lovelace: 2_000_000n, source: 'protocol' } });
    expect(s.certificates[1]).toMatchObject({ kind: 'stake_delegation' });
  });

  it('Conway and Shelley deregistrations show the refund', async () => {
    const conway = await summary(CONWAY_DEREGISTRATION_TX);
    expect(conway.certificates).toEqual([expect.objectContaining({ kind: 'stake_deregistration', form: 'conway', refund: { lovelace: 2_000_000n, source: 'body' } })]);
    expect(conway.deposits).toEqual({ paidLovelace: 0n, refundedLovelace: 2_000_000n });
    const shelley = await summary(SHELLEY_DEREGISTRATION_TX);
    expect(shelley.certificates).toEqual([expect.objectContaining({ kind: 'stake_deregistration', form: 'shelley', refund: { lovelace: 2_000_000n, source: 'protocol' } })]);
  });

  it('a wrong protocol deposit for a Shelley certificate does not balance, so it refuses', async () => {
    expect(await refusals(SHELLEY_DELEGATION_TX, { stakeKeyDepositLovelace: 1_000_000n })).toEqual([
      { code: 'value_not_balanced', path: 'body', detail: 'lovelace' },
    ]);
  });

  it('reference inputs are proven and show their reference script', async () => {
    const s = await summary(REFERENCE_INPUT_TX);
    expect(s.referenceInputs).toHaveLength(1);
    expect(s.referenceInputs[0]).toMatchObject({ txId: FUND_TX_ID, index: 3 });
    expect(s.referenceInputs[0].output.address.bech32).toBe(bech32(EXECUTOR_ENTERPRISE_ADDRESS));
    expect(s.referenceInputs[0].output.referenceScript).toEqual({ language: 'native', hash: VAULT_SCRIPT_HASH });
  });

  it('an output with many tokens lists every one of them', async () => {
    const s = await summary(MANY_TOKENS_TX);
    expect(s.outputs[0].value.tokens).toEqual(MANY_TOKEN_NAMES.map((name, i) => ({ policyId: POLICY_MANY, assetNameHex: name, quantity: BigInt(i + 1) })));
  });

  it('outputs to a script address: inline datum, reference script and a legacy datum hash, hashed from their bytes', async () => {
    const s = await summary(SCRIPT_OUTPUTS_TX);
    const [inline, legacy] = s.outputs;
    expect(inline.address).toMatchObject({ kind: 'enterprise', bech32: bech32(SCRIPT_ENTERPRISE_ADDRESS), payment: { kind: 'script', hash: 'cc'.repeat(28) }, stake: null });
    expect(inline.datum).toEqual({ kind: 'inline', hash: blake2b.hash(HexBlob(OUTPUT_DATUM), 32), cborHex: OUTPUT_DATUM });
    // OUTPUT_SCRIPT is [0, native] with the native script over an indefinite list: hashed as written.
    expect(inline.referenceScript).toEqual({ language: 'native', hash: blake2b.hash(HexBlob(`00${OUTPUT_SCRIPT.slice(4)}`), 28) });
    expect(legacy.datum).toEqual({ kind: 'hash', hash: 'dd'.repeat(32) });
  });

  it('change with the vault payment script and a foreign stake key shows that stake key', async () => {
    const s = await summary(FOREIGN_STAKE_CHANGE_TX);
    expect(s.outputs[0].address.bech32).toBe(bech32(VAULT_FOREIGN_STAKE_ADDRESS));
    expect(s.outputs[0].address.payment).toEqual({ kind: 'script', hash: VAULT_SCRIPT_HASH });
    expect(s.outputs[0].address.stake).toEqual({ kind: 'key', hash: 'f1'.repeat(28) });
  });

  it('takes bytes and the SDK transaction as well as hex, with the same result', async () => {
    const fromHex = await summary(PAYMENT_TX);
    const bytesResult = await decodeVaultTransaction(Uint8Array.from(Buffer.from(PAYMENT_TX, 'hex')), options());
    const sdkResult = await decodeVaultTransaction(Serialization.Transaction.fromCbor(HexBlob(PAYMENT_TX) as Serialization.TxCBOR), options());
    expect(bytesResult).toEqual({ status: 'decoded', summary: fromHex });
    expect(sdkResult).toEqual({ status: 'decoded', summary: fromHex });
  });
});

describe('decodeVaultTransaction: proven inputs', () => {
  it('an input no source serves is input_unresolved', async () => {
    expect(await refusals(PAYMENT_TX, { inputSources: [async () => new Map<string, string>()] })).toEqual([
      { code: 'input_unresolved', path: 'body.0[0]', detail: 'not_served' },
      { code: 'input_unresolved', path: 'body.0[1]', detail: 'not_served' },
    ]);
  });

  it('a creating transaction that does not hash to the input id proves nothing (a lied-about value)', async () => {
    const inflated = FUND_TX.replace(uint(100_000_000), uint(900_000_000));
    expect(inflated).not.toBe(FUND_TX);
    const liar = async () => new Map([[FUND_TX_ID, inflated]]);
    expect(await refusals(withEntries(), { inputSources: [liar] })).toEqual([
      { code: 'input_unresolved', path: 'body.0[0]', detail: 'wrong-transaction' },
    ]);
  });

  it('the next source is asked when one fails or lies', async () => {
    const failing = async (): Promise<Map<string, string>> => { throw new Error('offline'); };
    const liar = async () => new Map([[FUND_TX_ID, PAYMENT_TX]]);
    const s = await summary(withEntries(), { inputSources: [failing, liar, fundSource()] });
    expect(s.inputs[0].output.value.lovelace).toBe(100_000_000n);
  });

  it('a source that fails is reported when nothing else proves the input', async () => {
    const failing = async (): Promise<Map<string, string>> => { throw new Error('offline'); };
    expect(await refusals(withEntries(), { inputSources: [failing] })).toEqual([
      { code: 'input_unresolved', path: 'body.0[0]', detail: 'source_failed' },
    ]);
  });

  it('an index the creating transaction does not have is input_unresolved', async () => {
    const tx = transaction(entry(0, inputSet(40)), entry(1, array()), entry(2, uint(200_000)));
    expect(await refusals(tx)).toEqual([{ code: 'input_unresolved', path: 'body.0[0]', detail: 'no-such-output' }]);
  });

  it('collateral and reference inputs are proven too', async () => {
    const none = async () => new Map<string, string>();
    const tx = withEntries(entry(13, inputSet(2)), entry(18, inputSet(3)));
    expect((await refusals(tx, { inputSources: [none] })).map((r) => r.path)).toEqual(['body.0[0]', 'body.13[0]', 'body.18[0]']);
  });

  it('an input at a Byron or a pointer address refuses like such an output', async () => {
    const spend = (index: number) => transaction(entry(0, inputSet(index)), entry(1, array(legacyOutput(VAULT_ADDRESS, uint(800_000)))), entry(2, uint(200_000)));
    expect(await refusals(spend(7))).toEqual([{ code: 'address_byron_unsupported', path: 'body.0[0].address' }]);
    expect(await refusals(spend(8))).toEqual([{ code: 'address_pointer_unsupported', path: 'body.0[0].address' }]);
  });
});

describe('decodeVaultTransaction: refusals', () => {
  const refusedByKey: Array<[number, string, string]> = [
    [6, 'protocol_update_unsupported', 'update'],
    [7, 'auxiliary_data_unsupported', 'auxiliary_data_hash'],
    [9, 'mint_unsupported', 'mint'],
    [11, 'plutus_transition_unsupported', 'script_data_hash'],
    [19, 'governance_vote_unsupported', 'voting_procedures'],
    [20, 'governance_proposal_unsupported', 'proposal_procedures'],
    [21, 'treasury_unsupported', 'current_treasury_value'],
    [22, 'treasury_unsupported', 'donation'],
  ];
  it.each(refusedByKey)('body key %i refuses as %s', async (key, code, name) => {
    expect(await refusals(withEntries(entry(key, uint(0))))).toEqual([{ code, path: `body.${key}`, detail: name }]);
  });

  it('minting with a real mint value refuses', async () => {
    const mint = map([bytes(POLICY_1), map([bytes(GOLD), uint(5)])]);
    expect(await refusals(withEntries(entry(9, mint)))).toEqual([{ code: 'mint_unsupported', path: 'body.9', detail: 'mint' }]);
  });

  it.each([10, 12, 23, 24, 25, 26, 99, 255, 256, 65_535])('unknown body key %i refuses', async (key) => {
    expect(await refusals(withEntries(entry(key, uint(0))))).toEqual([{ code: 'body_key_unknown', path: `body.${key}` }]);
  });

  it('a body key that is not an unsigned integer refuses', async () => {
    expect(await refusals(withEntries([bytes('00'), uint(0)]))).toEqual([{ code: 'body_key_unknown', path: 'body[3]', detail: 'not_an_unsigned_integer' }]);
  });

  it('a repeated body key refuses', async () => {
    expect(await refusals(withEntries(entry(2, uint(200_000))))).toEqual([{ code: 'body_key_duplicate', path: 'body.2' }]);
  });

  it('a missing fee refuses', async () => {
    const tx = transaction(entry(0, inputSet(0)), entry(1, array(legacyOutput(VAULT_ADDRESS, uint(100_000_000)))));
    expect(await refusals(tx)).toEqual([{ code: 'body_key_missing', path: 'body.2' }]);
  });

  it('empty inputs refuse', async () => {
    const tx = transaction(entry(0, array()), entry(1, array()), entry(2, uint(0)));
    expect(await refusals(tx)).toEqual([{ code: 'field_malformed', path: 'body.0', detail: 'empty' }]);
  });

  it('a repeated input refuses', async () => {
    const tx = transaction(entry(0, inputSet(0, 0)), entry(1, array()), entry(2, uint(0)));
    expect(await refusals(tx)).toEqual([{ code: 'field_malformed', path: 'body.0', detail: 'duplicate_element' }]);
  });

  it.each([
    ['a Byron address', legacyOutput(BYRON_ADDRESS, uint(1_000_000)), 'address_byron_unsupported', undefined],
    ['a pointer address', legacyOutput(POINTER_ADDRESS, uint(1_000_000)), 'address_pointer_unsupported', undefined],
    ['a reward account', legacyOutput(VAULT_REWARD_ACCOUNT, uint(1_000_000)), 'address_invalid', 'reward_account'],
    ['a mainnet address on a testnet', legacyOutput(PAYEE_MAINNET_ADDRESS, uint(1_000_000)), 'network_mismatch', 'network_1'],
  ])('an output to %s refuses', async (_, output, code, detail) => {
    const expected = detail ? { code, path: 'body.1[0].address', detail } : { code, path: 'body.1[0].address' };
    expect(await refusals(payingTo(output, 98_800_000))).toEqual([expected]);
  });

  it('an output map key other than 0 to 3 refuses', async () => {
    const output = postAlonzoOutput(PAYEE_ADDRESS, uint(1_000_000), [entry(4, uint(0))]);
    expect(await refusals(payingTo(output, 98_800_000))).toEqual([{ code: 'output_field_unknown', path: 'body.1[0]', detail: 'key_4' }]);
  });

  it('a body network id for another network refuses', async () => {
    expect(await refusals(withEntries(entry(15, uint(1))))).toEqual([{ code: 'network_mismatch', path: 'body.15', detail: 'network_1' }]);
  });

  it('a fee above the limit refuses, default or given', async () => {
    const tx = transaction(entry(0, inputSet(0)), entry(1, array(legacyOutput(VAULT_ADDRESS, uint(94_000_000)))), entry(2, uint(6_000_000)));
    expect(await refusals(tx)).toEqual([{ code: 'fee_above_limit', path: 'body.2' }]);
    expect(await refusals(withEntries(), { maxFeeLovelace: 199_999n })).toEqual([{ code: 'fee_above_limit', path: 'body.2' }]);
    expect((await summary(withEntries(), { maxFeeLovelace: 200_000n })).fee).toBe(200_000n);
  });

  it('a body that does not balance refuses, in lovelace or in tokens', async () => {
    const short = transaction(entry(0, inputSet(0)), entry(1, array(legacyOutput(VAULT_ADDRESS, uint(99_700_000)))), entry(2, uint(200_000)));
    expect(await refusals(short)).toEqual([{ code: 'value_not_balanced', path: 'body', detail: 'lovelace' }]);
    const tokens = PAYMENT_TX.replace(`${bytes(GOLD)}${uint(300)}`, `${bytes(GOLD)}${uint(299)}`);
    expect(tokens).not.toBe(PAYMENT_TX);
    expect(await refusals(tokens)).toEqual([{ code: 'value_not_balanced', path: 'body', detail: 'tokens' }]);
  });

  it('a Shelley certificate without a stake key deposit refuses', async () => {
    expect(await refusals(SHELLEY_DEREGISTRATION_TX, { stakeKeyDepositLovelace: undefined })).toEqual([
      { code: 'deposit_unknown', path: 'body.4[0]' },
    ]);
  });

  it('a transaction marked invalid refuses', async () => {
    expect(await refusals(`${withEntries().slice(0, -4)}f4f6`)).toEqual([{ code: 'tx_marked_invalid', path: 'tx.is_valid' }]);
  });

  it('auxiliary data refuses, with or without its hash', async () => {
    expect(await refusals(`${withEntries().slice(0, -2)}a0`)).toEqual([{ code: 'auxiliary_data_unsupported', path: 'tx.auxiliary_data' }]);
  });

  it.each([
    ['not CBOR at all', 'ff'],
    ['not hex', 'zz'],
    ['a pre-Alonzo three-item transaction', `83${withEntries().slice(2, -6)}a0f6`],
    ['trailing bytes', `${withEntries()}00`],
  ])('%s is tx_undecodable', async (_, tx) => {
    expect((await refusals(tx)).map((r) => r.code)).toEqual(['tx_undecodable']);
  });

  it('every refusal is reported, and no summary is given', async () => {
    const tx = transaction(
      entry(0, inputSet(0)),
      entry(1, array(legacyOutput(PAYEE_ADDRESS, uint(1_000_000)), legacyOutput(BYRON_ADDRESS, uint(1_000_000)))),
      entry(2, uint(200_000)),
      entry(9, map([bytes(POLICY_1), map([bytes(GOLD), uint(5)])])),
      entry(30, uint(0)),
    );
    const result = await decodeVaultTransaction(tx, options());
    expect(result.status).toBe('refused');
    expect(result).not.toHaveProperty('summary');
    if (result.status !== 'decoded') {
      expect(result.txId).toBe(idOf(tx));
      expect(result.refusals.map((r) => r.code).sort()).toEqual(['address_byron_unsupported', 'body_key_unknown', 'mint_unsupported']);
    }
  });

  it('a reference input that is also spent refuses', async () => {
    expect(await refusals(withEntries(entry(18, inputSet(0))))).toEqual([{ code: 'reference_input_spent', path: 'body.18[0]' }]);
  });

  it('the pool, vote delegation, governance and removed certificates refuse by name', async () => {
    const cred = array(uint(1), bytes(VAULT_SCRIPT_HASH));
    const cases: Array<[string, string]> = [
      [array(uint(3), bytes(POOL_KEY_HASH)), 'certificate_pool_unsupported'],
      [array(uint(4), bytes(POOL_KEY_HASH), uint(300)), 'certificate_pool_unsupported'],
      [array(uint(9), cred, array(uint(2))), 'certificate_vote_delegation_unsupported'],
      [array(uint(16), cred, uint(500_000_000), 'f6'), 'certificate_governance_unsupported'],
      [array(uint(6), array()), 'certificate_unknown'],
    ];
    for (const [cert, code] of cases) {
      expect(await refusals(withEntries(entry(4, array(cert))))).toEqual([expect.objectContaining({ code, path: 'body.4[0]' })]);
    }
  });

  it('collateral addresses on a mainnet tx decoded for a testnet refuse', async () => {
    const tx = withEntries(entry(13, inputSet(2)), entry(16, legacyOutput(PAYEE_MAINNET_ADDRESS, uint(4_500_000))));
    expect(await refusals(tx)).toEqual([{ code: 'network_mismatch', path: 'body.16.address', detail: 'network_1' }]);
  });

  it('tokens that no input holds do not balance', async () => {
    const out = postAlonzoOutput(EXECUTOR_ADDRESS, coinAnd(1_000_000, map([bytes(POLICY_1), map([bytes(GOLD), uint(1)])])));
    expect((await refusals(payingTo(out, 98_800_000))).map((r) => r.code)).toEqual(['value_not_balanced']);
  });
});
