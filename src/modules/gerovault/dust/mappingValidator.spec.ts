import { describe, expect, it } from 'vitest';
import { Serialization } from '@cardano-sdk/core';
import {
  BURN_EX_UNITS,
  BURN_REDEEMER_CBOR,
  CREATE_EX_UNITS,
  CREATE_REDEEMER_CBOR,
  MAX_OPERATION_INPUTS,
  MEASURED_COST,
  SPEND_EX_UNITS,
  SPEND_REDEEMER_CBOR,
  budgetCovers,
  cnightAssetOf,
  decodeScriptMappingDatum,
  dustAddressHex,
  dustAddressOf,
  encodeScriptMappingDatum,
  mappingValidatorFor,
  plutusV3ScriptHash,
} from './mappingValidator';
import { redeemersCbor, scriptDataHashOf, sortedInputIndex } from './scriptData';
import { PREPROD_V3_COST_MODEL_EPOCH_327, deregisterDust, registerDust } from './__fixtures__/experimentTxs';

const EXPERIMENT_STAKE_SCRIPT = 'a3e2f7f91b8ca992446efdb52a6ccf8c6650a3c7a74ee6f98d96b88d';
const EXPERIMENT_DUST = 'mn_dust_preprod1wwcff2ckd4n5hfj43055td8glwtzkhhf6z88xwf0rpftvgstr7zpx43mk3q';
const EXPERIMENT_DUST_HEX = '73b094ab166d674ba6558be945b4e8fb962b5ee9d08e73392f1852b6220b1f8413';

const tx = (cbor: string) => Serialization.Transaction.fromCbor(cbor as Serialization.TxCBOR);

describe('the mapping validator', () => {
  it('is the preprod validator the experiment registered with, checked against its hash', () => {
    const validator = mappingValidatorFor('preprod')!;
    expect(validator.scriptHash).toBe('7e69087d98fac5869eac14e13dfb6f98228c41e638aa2a59d1f85e9c');
    expect(validator.address).toBe('addr_test1wplxjzranravtp574s2wz00md7vz9rzpucu252je68u9a8qzjheng');
    expect(plutusV3ScriptHash(validator.scriptCbor)).toBe(validator.scriptHash);
    // The very bytes the ledger accepted in the experiment's registration witness set.
    const witness = tx(registerDust.cbor).witnessSet().plutusV3Scripts()!.toCore();
    expect(witness.map(script => String(script.bytes))).toEqual([validator.scriptCbor]);
  });

  it('has no bytes for mainnet in this release, and preview shares the preprod deployment', () => {
    expect(mappingValidatorFor('mainnet')).toBeUndefined();
    expect(mappingValidatorFor('preview')?.scriptHash).toBe(mappingValidatorFor('preprod')?.scriptHash);
  });

  it('knows the cNIGHT asset of each network', () => {
    expect(cnightAssetOf('preprod')).toEqual({ policyId: 'd2dbff622e509dda256fedbd31ef6e9fd98ed49ad91d5c0e07f68af1', assetNameHex: '' });
  });
});

describe('the registration datum', () => {
  it('is byte for byte the datum of the experiment registration', () => {
    const datum = encodeScriptMappingDatum(EXPERIMENT_STAKE_SCRIPT, EXPERIMENT_DUST_HEX);
    const onChain = tx(registerDust.cbor).body().outputs()[0].datum()!.asInlineData()!.toCbor();
    expect(datum).toBe(onChain);
    expect(decodeScriptMappingDatum(datum)).toEqual({ scriptHash: EXPERIMENT_STAKE_SCRIPT, dustAddressHex: EXPERIMENT_DUST_HEX });
  });

  it('reads nothing but the script credential form with a 33-byte address', () => {
    const keyForm = `d8799fd8799f581c${EXPERIMENT_STAKE_SCRIPT}ff5821${EXPERIMENT_DUST_HEX}ff`;
    expect(decodeScriptMappingDatum(keyForm)).toBeNull();
    expect(decodeScriptMappingDatum(`d8799fd87a9f581c${EXPERIMENT_STAKE_SCRIPT}ff5820${'ab'.repeat(32)}ff`)).toBeNull();
    expect(decodeScriptMappingDatum(`${encodeScriptMappingDatum(EXPERIMENT_STAKE_SCRIPT, EXPERIMENT_DUST_HEX)}00`)).toBeNull();
    expect(() => encodeScriptMappingDatum(EXPERIMENT_STAKE_SCRIPT, 'ab'.repeat(32))).toThrow(TypeError);
  });
});

describe('DUST addresses', () => {
  it('read the network prefix and the 33-byte payload, both ways', () => {
    expect(dustAddressHex('preprod', EXPERIMENT_DUST)).toBe(EXPERIMENT_DUST_HEX);
    expect(dustAddressOf('preprod', EXPERIMENT_DUST_HEX)).toBe(EXPERIMENT_DUST);
    // A registration the preprod indexer reports with this address.
    expect(dustAddressHex('preprod', 'mn_dust_preprod1w02q4suq5erd2mt5k92heu27dq490w4nc9t5w96l80nygysasvnpjtw8kq2'))
      .toBe('73d40ac380a646d56d74b1557cf15e682a57bab3c15747175f3be644121d832619');
  });

  it('refuse another network, another kind of address and a changed character', () => {
    expect(dustAddressHex('mainnet', EXPERIMENT_DUST)).toBeUndefined();
    expect(dustAddressHex('preview', EXPERIMENT_DUST)).toBeUndefined();
    expect(dustAddressHex('preprod', EXPERIMENT_DUST.toUpperCase())).toBeUndefined();
    expect(dustAddressHex('preprod', `${EXPERIMENT_DUST.slice(0, -1)}p`)).toBeUndefined();
    expect(dustAddressHex('preprod', 'addr_test1wplxjzranravtp574s2wz00md7vz9rzpucu252je68u9a8qzjheng')).toBeUndefined();
  });
});

describe('the script data hash', () => {
  it('is the one the ledger accepted for the experiment registration', () => {
    const registration = tx(registerDust.cbor);
    const onChain = registration.witnessSet().redeemers()!.toCbor();
    // The experiment declared what the node measured; this wallet declares its own fixed budget.
    const ours = redeemersCbor([{ purpose: 'mint', index: 0, dataCbor: CREATE_REDEEMER_CBOR, exUnits: { memory: 80_682, steps: 30_217_720 } }]);
    expect(ours).toBe(onChain);
    expect(scriptDataHashOf(onChain, PREPROD_V3_COST_MODEL_EPOCH_327)).toBe(registration.body().scriptDataHash());
  });

  it('is the one the ledger accepted for the experiment deregistration (spend and burn)', () => {
    const deregistration = tx(deregisterDust.cbor);
    const inputs = deregistration.body().inputs().toCore().map(({ txId, index }) => ({ txId: String(txId), index }));
    const spendIndex = sortedInputIndex(inputs, registerDust.id, 0);
    const ours = redeemersCbor([
      { purpose: 'mint', index: 0, dataCbor: BURN_REDEEMER_CBOR, exUnits: { memory: 39_203, steps: 14_642_274 } },
      { purpose: 'spend', index: spendIndex, dataCbor: SPEND_REDEEMER_CBOR, exUnits: { memory: 79_118, steps: 26_357_885 } },
    ]);
    expect(ours).toBe(deregistration.witnessSet().redeemers()!.toCbor());
    expect(scriptDataHashOf(ours, PREPROD_V3_COST_MODEL_EPOCH_327)).toBe(deregistration.body().scriptDataHash());
  });

  it('declares budgets that cover the measured cost at the most inputs an operation spends, with half again to spare', () => {
    // A deregistration spends the vault's inputs and the registration.
    const inputs = MAX_OPERATION_INPUTS + 1;
    expect(budgetCovers(CREATE_EX_UNITS, MEASURED_COST.create, inputs)).toBe(true);
    expect(budgetCovers(SPEND_EX_UNITS, MEASURED_COST.spend, inputs)).toBe(true);
    expect(budgetCovers(BURN_EX_UNITS, MEASURED_COST.burn, inputs)).toBe(true);
    // The model reproduces what the preprod node measured for two inputs.
    expect(MEASURED_COST.burn.base.memory + MEASURED_COST.burn.perInput.memory).toBeGreaterThanOrEqual(44_921);
    expect(MEASURED_COST.burn.base.steps + MEASURED_COST.burn.perInput.steps).toBeGreaterThanOrEqual(17_920_479);
  });
});
