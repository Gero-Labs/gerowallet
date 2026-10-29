// Which of the wallet's programmable UTxOs Gero's Send spends. The background picks them, so
// the page never handles input refs; one transfer spends one owner's UTxOs (Nexus refuses
// mixed owners), holding the one token and ADA only, as few as cover the amount.
import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { CIP113_MAX_PROGRAMMABLE_INPUTS, selectCip113TransferInputs } from './cip113SelectInputs';
import { CIP113_BASE_PREPROD } from '@/utils/cip113Deployments';
import { MICKY_UNIT, TEST_WALLET_PAYMENT_KEY_HASH, TEST_WALLET_PLB_ADDRESS, TEST_WALLET_STAKE_KEY_HASH } from './__fixtures__/cip113Preprod';

const PLB = CIP113_BASE_PREPROD[0];
const BASES = new Set([PLB]);
const OTHER_UNIT = `${'ab'.repeat(28)}4f54484552`;
const REFERENCE_UNIT = `${MICKY_UNIT.slice(0, 56)}000643b04d69636b79555344`; // CIP-68 label 100

function plbAddress(owner: string, base = PLB): string {
  return Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { hash: Hash28ByteBase16(base), type: Cardano.CredentialType.ScriptHash },
    { hash: Hash28ByteBase16(owner), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

let seq = 0;
function utxo(address: string, assets: Record<string, bigint>, extra: Partial<Cardano.TxOut> = {}): Cardano.Utxo {
  seq += 1;
  return [
    { txId: Cardano.TransactionId(seq.toString(16).padStart(64, '0')), index: 0, address: address as Cardano.PaymentAddress },
    {
      address: address as Cardano.PaymentAddress,
      value: { coins: 1_236_970n, assets: new Map(Object.entries(assets)) as Cardano.TokenMap },
      ...extra,
    },
  ] as Cardano.Utxo;
}

const ref = (u: Cardano.Utxo) => `${u[0].txId}#${u[0].index}`;

describe('selectCip113TransferInputs', () => {
  it('picks the one UTxO holding the amount, with its owner and address', () => {
    const micky = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 21_000_000n });
    const result = selectCip113TransferInputs([micky], MICKY_UNIT, 1_000_000n, BASES);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.utxos.map(ref)).toEqual([ref(micky)]);
    expect(result.selection.ownerKeyHash).toBe(TEST_WALLET_STAKE_KEY_HASH);
    expect(result.selection.address).toBe(TEST_WALLET_PLB_ADDRESS);
    expect(result.selection.baseScriptHash).toBe(PLB);
    expect(result.selection.total).toBe(21_000_000n);
  });

  it('takes the fewest UTxOs: largest first', () => {
    const small = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 3n });
    const large = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 8n });
    const mid = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 5n });
    const result = selectCip113TransferInputs([small, large, mid], MICKY_UNIT, 12n, BASES);

    expect(result.ok && result.selection.utxos.map(ref)).toEqual([ref(large), ref(mid)]);
    expect(result.ok && result.selection.total).toBe(13n);
  });

  it("never mixes owners; picks the owner covering the amount in the fewest UTxOs", () => {
    const paymentOwned = plbAddress(TEST_WALLET_PAYMENT_KEY_HASH);
    const stakeA = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 4n });
    const stakeB = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 4n });
    const payment = utxo(paymentOwned, { [MICKY_UNIT]: 9n });
    const result = selectCip113TransferInputs([stakeA, stakeB, payment], MICKY_UNIT, 7n, BASES);

    expect(result.ok && result.selection.utxos.map(ref)).toEqual([ref(payment)]);
    expect(result.ok && result.selection.ownerKeyHash).toBe(TEST_WALLET_PAYMENT_KEY_HASH);
  });

  it('refuses an amount only owners together hold, and says the most one transfer can send', () => {
    const stake = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 4n });
    const payment = utxo(plbAddress(TEST_WALLET_PAYMENT_KEY_HASH), { [MICKY_UNIT]: 6n });
    const result = selectCip113TransferInputs([stake, payment], MICKY_UNIT, 8n, BASES);

    expect(result).toEqual({ ok: false, reason: 'NOT_IN_ONE_TRANSFER', maxSingleTransfer: 6n });
  });

  it('refuses more than the wallet holds', () => {
    const stake = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 4n });
    expect(selectCip113TransferInputs([stake], MICKY_UNIT, 5n, BASES))
      .toEqual({ ok: false, reason: 'INSUFFICIENT', maxSingleTransfer: 4n });
    expect(selectCip113TransferInputs([], MICKY_UNIT, 1n, BASES))
      .toEqual({ ok: false, reason: 'INSUFFICIENT', maxSingleTransfer: 0n });
  });

  it('skips UTxOs holding another token too, a reference script or a datum hash', () => {
    const mixed = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 50n, [OTHER_UNIT]: 1n });
    const withScript = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 50n }, {
      scriptReference: { __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V3, bytes: '4e4d01000033222220051200120011' } as Cardano.Script,
    });
    const withHash = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 50n }, { datumHash: Hash32ByteBase16('00'.repeat(32)) });
    const plain = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 2n });
    const result = selectCip113TransferInputs([mixed, withScript, withHash, plain], MICKY_UNIT, 2n, BASES);

    expect(result.ok && result.selection.utxos.map(ref)).toEqual([ref(plain)]);
    expect(selectCip113TransferInputs([mixed, withScript, withHash], MICKY_UNIT, 2n, BASES))
      .toEqual({ ok: false, reason: 'INSUFFICIENT', maxSingleTransfer: 0n });
  });

  it('skips UTxOs at another PLB or with a script owner', () => {
    const otherBase = utxo(plbAddress(TEST_WALLET_STAKE_KEY_HASH, '11'.repeat(28)), { [MICKY_UNIT]: 50n });
    const scriptOwner = utxo(Cardano.BaseAddress.fromCredentials(
      Cardano.NetworkId.Testnet,
      { hash: Hash28ByteBase16(PLB), type: Cardano.CredentialType.ScriptHash },
      { hash: Hash28ByteBase16('22'.repeat(28)), type: Cardano.CredentialType.ScriptHash },
    ).toAddress().toBech32(), { [MICKY_UNIT]: 50n });
    expect(selectCip113TransferInputs([otherBase, scriptOwner], MICKY_UNIT, 1n, BASES).ok).toBe(false);
  });

  it('refuses a CIP-68 reference token (label 100), a zero or negative amount and a malformed unit', () => {
    const ref100 = utxo(TEST_WALLET_PLB_ADDRESS, { [REFERENCE_UNIT]: 1n });
    expect(selectCip113TransferInputs([ref100], REFERENCE_UNIT, 1n, BASES).ok).toBe(false);
    const micky = utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 5n });
    expect(selectCip113TransferInputs([micky], MICKY_UNIT, 0n, BASES).ok).toBe(false);
    expect(selectCip113TransferInputs([micky], MICKY_UNIT, -1n, BASES).ok).toBe(false);
    expect(selectCip113TransferInputs([micky], 'lovelace', 1n, BASES).ok).toBe(false);
  });

  it(`never selects more than ${CIP113_MAX_PROGRAMMABLE_INPUTS} UTxOs`, () => {
    const many = Array.from({ length: CIP113_MAX_PROGRAMMABLE_INPUTS + 3 }, () => utxo(TEST_WALLET_PLB_ADDRESS, { [MICKY_UNIT]: 1n }));
    expect(selectCip113TransferInputs(many, MICKY_UNIT, BigInt(CIP113_MAX_PROGRAMMABLE_INPUTS + 1), BASES))
      .toEqual({ ok: false, reason: 'NOT_IN_ONE_TRANSFER', maxSingleTransfer: BigInt(CIP113_MAX_PROGRAMMABLE_INPUTS) });
    const result = selectCip113TransferInputs(many, MICKY_UNIT, BigInt(CIP113_MAX_PROGRAMMABLE_INPUTS), BASES);
    expect(result.ok && result.selection.utxos.length).toBe(CIP113_MAX_PROGRAMMABLE_INPUTS);
  });
});
