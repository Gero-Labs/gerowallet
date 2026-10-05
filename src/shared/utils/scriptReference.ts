import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { debugLog } from '@/utils/debug';

/**
 * A UTxO's reference script as the `Cardano.Script` cardano-js-sdk serializes.
 *
 * gero-sync hands the wallet the script in one of two shapes, and cardano-js-sdk reads neither
 * as it is: `Serialization.Script.fromCore` threw "Unexpected Plutus language version", which
 * failed every CIP-30 getUtxos / getCollateral and swap-signing call of a wallet that held such
 * a UTxO.
 * - Nexus rows carry `{hash, size, type, bytes, value | json}`. `type` is `native`, `plutusV1`,
 *   `plutusV2` or `plutusV3`, and `bytes` is the script exactly as the ledger hashes it: for
 *   Plutus the serialised script (one CBOR byte string around the flat program, the layer
 *   `Cardano.PlutusScript.bytes` holds), for native the native-script CBOR.
 * - gero-sync's own block rows carry yaci's `script_ref`: the CIP-33 `[languageTag, script]`
 *   CBOR, as a hex string.
 *
 * A `Cardano.Script` comes back unchanged, so stored UTxOs can go through this again whatever
 * wrote them. Anything else must re-hash to the hash it came with. A hash-only row, a native
 * script Koios sent as JSON only, or bytes that hash to something else give no script rather
 * than a different one.
 */
export function toScriptReference(ref: unknown): Cardano.Script | undefined {
  if (ref === null || ref === undefined || ref === '') {
    return undefined;
  }
  if (typeof ref === 'string') {
    return scriptFromCip33(ref);
  }
  if (typeof ref !== 'object') {
    return undefined;
  }
  if (isCoreScript(ref)) {
    return ref;
  }
  const { hash, type, bytes } = ref as { hash?: unknown; type?: unknown; bytes?: unknown };
  if (typeof type !== 'string' || typeof bytes !== 'string' || bytes === '') {
    return undefined;
  }
  const expected = typeof hash === 'string' ? hash.toLowerCase() : undefined;
  for (const candidate of candidates(type.toLowerCase(), bytes.toLowerCase())) {
    if (candidate && (expected === undefined || hashOf(candidate) === expected)) {
      return candidate;
    }
  }
  debugLog('Reference script could not be rebuilt; the UTxO is kept without it', hash);
  return undefined;
}

/**
 * The readings of `bytes` worth trying, the contract's first. Until 2026-09-30 Nexus served
 * address UTxOs' Plutus scripts one byte-string layer deeper, and wallets still hold those.
 */
function candidates(type: string, bytes: string): Array<Cardano.Script | undefined> {
  if (type === 'native') {
    return [nativeFromCbor(bytes)];
  }
  const version = plutusVersion(type);
  if (version === undefined) {
    return [];
  }
  const plutus = (scriptBytes: string | undefined): Cardano.PlutusScript | undefined => {
    try {
      return scriptBytes === undefined
        ? undefined
        : { __type: Cardano.ScriptType.Plutus, version, bytes: HexBlob(scriptBytes) };
    } catch {
      return undefined; // not hex
    }
  };
  return [plutus(bytes), plutus(byteStringContent(bytes))];
}

/** Looked up per call rather than held in a constant, so importing this module reads nothing from the SDK. */
function plutusVersion(type: string): Cardano.PlutusLanguageVersion | undefined {
  switch (type) {
    case 'plutusv1':
      return Cardano.PlutusLanguageVersion.V1;
    case 'plutusv2':
      return Cardano.PlutusLanguageVersion.V2;
    case 'plutusv3':
      return Cardano.PlutusLanguageVersion.V3;
    default:
      return undefined;
  }
}

function isCoreScript(ref: object): ref is Cardano.Script {
  const kind = (ref as { __type?: unknown }).__type;
  return kind === Cardano.ScriptType.Native || kind === Cardano.ScriptType.Plutus;
}

function scriptFromCip33(hex: string): Cardano.Script | undefined {
  try {
    return Serialization.Script.fromCbor(HexBlob(hex)).toCore();
  } catch {
    return undefined;
  }
}

function nativeFromCbor(hex: string): Cardano.Script | undefined {
  try {
    return Serialization.NativeScript.fromCbor(HexBlob(hex)).toCore();
  } catch {
    return undefined;
  }
}

/** The content of the single CBOR byte string `hex` consists of, or undefined. */
function byteStringContent(hex: string): string | undefined {
  try {
    const reader = new Serialization.CborReader(HexBlob(hex));
    const content = reader.readByteString();
    return reader.peekState() === Serialization.CborReaderState.Finished ? HexBlob.fromBytes(content) : undefined;
  } catch {
    return undefined;
  }
}

function hashOf(script: Cardano.Script): string | undefined {
  try {
    return Serialization.Script.fromCore(script).hash();
  } catch {
    return undefined;
  }
}
