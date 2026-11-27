import { describe, expect, it } from 'vitest';
import { blake2b } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { COLLATERAL_DATUM, COLLATERAL_SCRIPT, inlineDatumOption, OUTPUT_SCRIPT } from '@/shared/utils/__fixtures__/handAssembledTxs';
import { fromHex } from './cbor';
import { decodeOutput, decodeScript } from './outputs';
import { FieldRefusal } from './refusals';
import { array, bytes, entry, legacyOutput, map, PAYEE_ADDRESS, postAlonzoOutput, uint, VAULT_SCRIPT, VAULT_SCRIPT_HASH } from './__fixtures__/vaultTxs';

const decode = (hex: string) => decodeOutput(fromHex(hex), 'o', 0);
const refusalOf = (hex: string) => {
  try {
    decode(hex);
  } catch (e) {
    if (e instanceof FieldRefusal) return e.refusal;
    throw e;
  }
  throw new Error('expected a refusal');
};
const scriptRef = (script: string) => entry(3, `d818${bytes(script)}`);

describe('decodeOutput', () => {
  it('reads the legacy encodings, with and without a datum hash', () => {
    expect(decode(legacyOutput(PAYEE_ADDRESS, uint(1_000_000)))).toMatchObject({ value: { lovelace: 1_000_000n }, datum: null, referenceScript: null });
    expect(decode(legacyOutput(PAYEE_ADDRESS, uint(1), 'ab'.repeat(32))).datum).toEqual({ kind: 'hash', hash: 'ab'.repeat(32) });
  });

  it('reads the post-Alonzo map, keys in any order', () => {
    const output = map(entry(1, uint(7)), entry(0, bytes(PAYEE_ADDRESS)));
    expect(decode(output)).toMatchObject({ address: { hex: PAYEE_ADDRESS }, value: { lovelace: 7n } });
  });

  it('hashes an inline datum over its bytes as written', () => {
    const view = decode(postAlonzoOutput(PAYEE_ADDRESS, uint(1), [entry(2, inlineDatumOption(COLLATERAL_DATUM))]));
    expect(view.datum).toEqual({ kind: 'inline', hash: blake2b.hash(HexBlob(COLLATERAL_DATUM), 32), cborHex: COLLATERAL_DATUM });
  });

  it('hashes reference scripts over the bytes as written: native (indefinite list) and Plutus (chunked)', () => {
    expect(decode(postAlonzoOutput(PAYEE_ADDRESS, uint(1), [scriptRef(array(uint(0), VAULT_SCRIPT))])).referenceScript)
      .toEqual({ language: 'native', hash: VAULT_SCRIPT_HASH });
    expect(decode(postAlonzoOutput(PAYEE_ADDRESS, uint(1), [scriptRef(OUTPUT_SCRIPT)])).referenceScript)
      .toEqual({ language: 'native', hash: blake2b.hash(HexBlob(`00${OUTPUT_SCRIPT.slice(4)}`), 28) });
    // [2, (_ h'4e4d010000', h'33222220051200120011')]: Plutus V2, the flat bytes are the chunks joined.
    expect(decode(postAlonzoOutput(PAYEE_ADDRESS, uint(1), [scriptRef(COLLATERAL_SCRIPT)])).referenceScript)
      .toEqual({ language: 'plutus_v2', hash: blake2b.hash(HexBlob('024e4d01000033222220051200120011'), 28) });
  });

  it.each([
    ['a map key 4', postAlonzoOutput(PAYEE_ADDRESS, uint(1), [entry(4, uint(0))]), { code: 'output_field_unknown', path: 'o', detail: 'key_4' }],
    ['a repeated map key', map(entry(0, bytes(PAYEE_ADDRESS)), entry(1, uint(1)), entry(1, uint(2))), { code: 'field_malformed', path: 'o', detail: 'duplicate_key' }],
    ['no value', map(entry(0, bytes(PAYEE_ADDRESS))), { code: 'field_malformed', path: 'o', detail: 'output_missing_address_or_value' }],
    ['a legacy array of four', array(bytes(PAYEE_ADDRESS), uint(1), bytes('ab'.repeat(32)), uint(0)), { code: 'variant_unknown', path: 'o', detail: 'legacy_output_length_4' }],
    ['datum option 2', postAlonzoOutput(PAYEE_ADDRESS, uint(1), [entry(2, array(uint(2), bytes('00')))]), { code: 'variant_unknown', path: 'o.datum', detail: 'datum_option_2' }],
    ['an inline datum without tag 24', postAlonzoOutput(PAYEE_ADDRESS, uint(1), [entry(2, array(uint(1), bytes('01')))]), { code: 'field_malformed', path: 'o.datum', detail: 'expected_tag_24' }],
    ['script language 4', postAlonzoOutput(PAYEE_ADDRESS, uint(1), [scriptRef(array(uint(4), bytes('00')))]), { code: 'variant_unknown', path: 'o.script_ref', detail: 'script_4' }],
    ['a native script that is not one', postAlonzoOutput(PAYEE_ADDRESS, uint(1), [scriptRef(array(uint(0), array(uint(9))))]), { code: 'field_malformed', path: 'o.script_ref', detail: 'native_script' }],
    ['a short datum hash', legacyOutput(PAYEE_ADDRESS, uint(1), 'ab'.repeat(31)), { code: 'field_malformed', path: 'o.datum', detail: 'expected_32_bytes' }],
    ['not an output', uint(1), { code: 'field_malformed', path: 'o', detail: 'expected_output' }],
  ])('refuses %s', (_, hex, refusal) => {
    expect(refusalOf(hex)).toEqual(refusal);
  });
});

describe('decodeScript', () => {
  it('names the language', () => {
    expect(decodeScript(fromHex(array(uint(3), bytes('0102'))), 's')).toEqual({ language: 'plutus_v3', hash: blake2b.hash(HexBlob('030102'), 28) });
    expect(decodeScript(fromHex(array(uint(1), bytes('0102'))), 's').language).toBe('plutus_v1');
  });
});
