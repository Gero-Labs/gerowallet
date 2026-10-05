import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { toScriptReference } from './scriptReference';
import {
  MAINNET_PLUTUS_V3,
  PREVIEW_NATIVE_AT_LEAST,
  PREVIEW_NATIVE_BEFORE,
  PREVIEW_NATIVE_SIG,
  PREVIEW_PLUTUS_V2,
} from './__fixtures__/referenceScripts';

/** The ledger's own check on a script: the hash cardano-js-sdk derives from it. */
const hashOf = (script: Cardano.Script) => Serialization.Script.fromCore(script).hash();

describe('toScriptReference', () => {
  it('builds a Plutus script from Nexus {type, bytes}, re-hashing to the hash Nexus sent', () => {
    // Address UTxOs name the JSON field `value`, account UTxOs `json`; both are null.
    const { hash, size, bytes } = MAINNET_PLUTUS_V3;
    const fromAddress = toScriptReference({ hash, size, type: 'plutusV3', bytes, value: null });
    const fromAccount = toScriptReference({
      hash: PREVIEW_PLUTUS_V2.hash, size: PREVIEW_PLUTUS_V2.size, type: 'plutusV2', bytes: PREVIEW_PLUTUS_V2.bytes, json: null,
    });

    expect(fromAddress).toEqual({
      __type: Cardano.ScriptType.Plutus,
      version: Cardano.PlutusLanguageVersion.V3,
      bytes: MAINNET_PLUTUS_V3.bytes,
    });
    expect(hashOf(fromAddress!)).toBe(MAINNET_PLUTUS_V3.hash);
    expect(fromAccount).toMatchObject({ __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V2 });
    expect(hashOf(fromAccount!)).toBe(PREVIEW_PLUTUS_V2.hash);
  });

  it('builds native scripts from their CBOR, a nested one included', () => {
    for (const fixture of [PREVIEW_NATIVE_SIG, PREVIEW_NATIVE_AT_LEAST, PREVIEW_NATIVE_BEFORE]) {
      const script = toScriptReference({ hash: fixture.hash, size: fixture.bytes.length / 2, type: 'native', bytes: fixture.bytes });

      expect(script?.__type).toBe(Cardano.ScriptType.Native);
      expect(hashOf(script!)).toBe(fixture.hash);
    }
    expect(toScriptReference({ hash: PREVIEW_NATIVE_SIG.hash, type: 'native', bytes: PREVIEW_NATIVE_SIG.bytes }))
      .toEqual({ __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireSignature, keyHash: '1c12f03c1ef2e935acc35ec2e6f96c650fd3bfba3e96550504d53361' });
  });

  it("reads gero-sync's block rows, which carry the CIP-33 script as a hex string", () => {
    const native = toScriptReference(PREVIEW_NATIVE_BEFORE.cip33);
    const plutus = toScriptReference(MAINNET_PLUTUS_V3.cip33);

    expect(native).toEqual({ __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireTimeBefore, slot: 888268 });
    expect(hashOf(plutus!)).toBe(MAINNET_PLUTUS_V3.hash);
    expect((plutus as Cardano.PlutusScript).bytes).toBe(MAINNET_PLUTUS_V3.bytes);
  });

  it('reads the double-wrapped Plutus bytes Nexus served before 2026-09-30, still in wallet caches', () => {
    // `8203` stripped from yaci-store's script_ref left one byte-string layer too many.
    const legacy = { hash: MAINNET_PLUTUS_V3.hash, type: 'plutusV3', bytes: MAINNET_PLUTUS_V3.cip33.slice(4) };

    expect(hashOf(toScriptReference(legacy)!)).toBe(MAINNET_PLUTUS_V3.hash);
  });

  it('passes a Cardano.Script through unchanged, so stored UTxOs can be run through it again', () => {
    const script = toScriptReference({ hash: PREVIEW_PLUTUS_V2.hash, type: 'plutusV2', bytes: PREVIEW_PLUTUS_V2.bytes })!;

    expect(toScriptReference(script)).toBe(script);
  });

  it('gives no script, rather than a wrong one, when it cannot rebuild the one on chain', () => {
    // Only the hash: yaci-store REST rows, and Nexus where it has no bytes.
    expect(toScriptReference({ hash: PREVIEW_PLUTUS_V2.hash })).toBeUndefined();
    // A native script Koios sent as JSON only, under its own type name.
    expect(toScriptReference({ hash: PREVIEW_NATIVE_BEFORE.hash, type: 'timelock', bytes: null, json: PREVIEW_NATIVE_BEFORE.koiosJson })).toBeUndefined();
    // Bytes that do not hash to the hash they came with.
    expect(toScriptReference({ hash: PREVIEW_PLUTUS_V2.hash, type: 'plutusV3', bytes: PREVIEW_PLUTUS_V2.bytes })).toBeUndefined();
    expect(toScriptReference({ hash: PREVIEW_PLUTUS_V2.hash, type: 'plutusV2', bytes: 'zz' })).toBeUndefined();
    expect(toScriptReference('deadbeef')).toBeUndefined();
    expect(toScriptReference(null)).toBeUndefined();
    expect(toScriptReference(undefined)).toBeUndefined();
  });
});
