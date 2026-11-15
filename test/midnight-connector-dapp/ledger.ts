/**
 * Ledger 9 helpers for the connector test dApp: what a real dApp does with
 * `@midnightntwrk/ledger-v9` around the wallet calls. Nothing here talks to
 * the wallet; `main.ts` does.
 *
 * - Address codec: bech32m `mn_addr…` <-> the ledger's `UserAddress` hex.
 * - `buildDappTransfer`: a transaction the dApp builds itself, the shape
 *   `balanceUnsealedTransaction` takes (`signature / proof / pre-binding`):
 *   one intent whose guaranteed unshielded offer pays outputs and spends
 *   nothing, so the wallet must fund it, pay the DUST fee, sign and seal it.
 * - `decodeTransaction`: reads any transaction hex the wallet returns.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { Buffer } from 'buffer';
import { MidnightBech32m, UnshieldedAddress } from 'midnight-v9-address-format';
import type { ProvingProvider as ConnectorProvingProvider } from '@midnightntwrk/dapp-connector-api';

/** USDM on mainnet (src/chains/midnight/midnightTokenRegistry.ts). */
export const USDM_MAINNET = '8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b';
/** NIGHT, the native unshielded token. */
export const NIGHT = ledger.nativeToken().raw;

export function tokenLabel(raw: string): string {
  if (raw === NIGHT) return 'NIGHT';
  if (raw.toLowerCase() === USDM_MAINNET) return 'USDM';
  return `${raw.slice(0, 8)}…${raw.slice(-4)}`;
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('Not a hex string');
  }
  return new Uint8Array(Buffer.from(clean, 'hex'));
}

/** `mn_addr…` -> `UserAddress` hex. `network` is the connector's network id. */
export function addressToHex(network: string, bech32: string): string {
  return UnshieldedAddress.codec.decode(network, MidnightBech32m.parse(bech32.trim())).hexString;
}

/** `UserAddress` hex -> `mn_addr…`; the hex itself when it does not encode. */
export function addressFromHex(network: string, hex: string): string {
  try {
    return UnshieldedAddress.codec.encode(network, new UnshieldedAddress(Buffer.from(hex, 'hex'))).asString();
  } catch {
    return hex;
  }
}

/**
 * The connector's provider has `check` and `prove`; the ledger's type also
 * wants `lookupKey`. Built-in circuits need no key material, and a dApp
 * contract call would answer from its own key store here.
 */
export function asLedgerProvider(provider: ConnectorProvingProvider): ledger.ProvingProvider {
  return {
    check: (preimage, keyLocation) => provider.check(preimage, keyLocation),
    prove: (preimage, keyLocation, overwrite) => provider.prove(preimage, keyLocation, overwrite),
    lookupKey: () => Promise.resolve(undefined),
  };
}

export interface DappOutput {
  token: string;
  value: bigint;
  recipient: string;
}

/**
 * A dApp-built, proven, unbound transaction that pays `outputs` and spends
 * nothing. Proving runs through `provider` (the wallet's); an unshielded-only
 * intent has no circuits, so this mostly checks the provider can be used.
 */
export async function buildDappTransfer(
  network: string,
  outputs: DappOutput[],
  ttlMinutes: number,
  provider: ledger.ProvingProvider,
): Promise<string> {
  const intent = ledger.Intent.new(new Date(Date.now() + ttlMinutes * 60_000));
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
    [],
    outputs.map((o) => ({ value: o.value, owner: addressToHex(network, o.recipient), type: o.token })),
    [],
  );
  const unproven = ledger.Transaction.fromParts(network, undefined, undefined, intent);
  const proven = await unproven.prove(provider, ledger.CostModel.initialCostModel());
  return toHex(proven.serialize());
}

type Markers = readonly [string, string, string];
/** Most finished first: a sealed tx also reads under looser markers in some versions. */
const MARKERS: Array<{ stage: string; markers: Markers }> = [
  { stage: 'sealed (proof, binding)', markers: ['signature', 'proof', 'binding'] },
  { stage: 'proven, unbound (proof, pre-binding)', markers: ['signature', 'proof', 'pre-binding'] },
  { stage: 'unproven (pre-proof, pre-binding)', markers: ['signature', 'pre-proof', 'pre-binding'] },
  { stage: 'proofs erased (no-proof, no-binding)', markers: ['signature', 'no-proof', 'no-binding'] },
];

type AnyTx = ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>;

function deserialize(bytes: Uint8Array, markers: Markers): AnyTx {
  const [s, p, b] = markers;
  // The marker strings are the ledger's own `instance` names; the generic
  // signature cannot follow a runtime choice, so the call is untyped here.
  const tx: unknown = (ledger.Transaction.deserialize as (s: string, p: string, b: string, raw: Uint8Array) => unknown)(s, p, b, bytes);
  return tx as AnyTx;
}

export interface DecodedOutput { token: string; value: string; owner: string }
export interface DecodedInput { token: string; value: string; owner: string }
export interface DecodedOffer { inputs: DecodedInput[]; outputs: DecodedOutput[]; signatures: number }
export interface DecodedSegment {
  segment: number;
  ttl: string;
  guaranteed?: DecodedOffer;
  fallible?: DecodedOffer;
  contractActions: number;
  dustSpends: number;
  dustRegistrations: number;
  imbalances: Array<{ token: string; value: string }>;
}
/** A value, or why the ledger would not give it (a hash exists only once a tx is proven, signed and bound). */
export type Attempt<T> = T | { unavailable: string };

function attempt<T>(read: () => T): Attempt<T> {
  try {
    return read();
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : String(error) };
  }
}

export interface DecodedTransaction {
  stage: string;
  network: string;
  bytes: number;
  hash: Attempt<string>;
  identifiers: Attempt<string[]>;
  segments: DecodedSegment[];
  shielded: { inputs: number; outputs: number; transients: number; fallibleSegments: number };
  guaranteedPhaseImbalances: Array<{ token: string; value: string }>;
}

function decodeOffer(network: string, offer: ledger.UnshieldedOffer<ledger.Signaturish> | undefined): DecodedOffer | undefined {
  if (!offer) return undefined;
  return {
    inputs: offer.inputs.map((i) => ({
      token: tokenLabel(i.type),
      value: i.value.toString(),
      owner: addressFromHex(network, ledger.addressFromKey(i.owner)),
    })),
    outputs: offer.outputs.map((o) => ({ token: tokenLabel(o.type), value: o.value.toString(), owner: addressFromHex(network, o.owner) })),
    signatures: offer.signatures.length,
  };
}

function imbalancesOf(tx: AnyTx, segment: number): Array<{ token: string; value: string }> {
  return [...tx.imbalances(segment)].map(([token, value]) => ({
    token: `${token.tag}:${'raw' in token ? tokenLabel(token.raw) : ''}`,
    value: value.toString(),
  }));
}

/** Decode `hex` under the first marker set it reads as. Throws with every attempt's error otherwise. */
export function decodeTransaction(network: string, hex: string): DecodedTransaction {
  const bytes = fromHex(hex);
  const errors: string[] = [];
  for (const { stage, markers } of MARKERS) {
    let tx: AnyTx;
    try {
      tx = deserialize(bytes, markers);
    } catch (error) {
      errors.push(`${stage}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const segments: DecodedSegment[] = [...(tx.intents ?? new Map())].map(([segment, intent]) => ({
      segment,
      ttl: intent.ttl.toISOString(),
      guaranteed: decodeOffer(network, intent.guaranteedUnshieldedOffer),
      fallible: decodeOffer(network, intent.fallibleUnshieldedOffer),
      contractActions: intent.actions.length,
      dustSpends: intent.dustActions?.spends.length ?? 0,
      dustRegistrations: intent.dustActions?.registrations.length ?? 0,
      imbalances: imbalancesOf(tx, segment),
    }));
    const guaranteed = tx.guaranteedOffer;
    return {
      stage,
      network,
      bytes: bytes.length,
      hash: attempt(() => String(tx.transactionHash())),
      identifiers: attempt(() => tx.identifiers().map(String)),
      segments,
      shielded: {
        inputs: guaranteed?.inputs.length ?? 0,
        outputs: guaranteed?.outputs.length ?? 0,
        transients: guaranteed?.transients.length ?? 0,
        fallibleSegments: tx.fallibleOffer?.size ?? 0,
      },
      guaranteedPhaseImbalances: imbalancesOf(tx, 0),
    };
  }
  throw new Error(`Not a ledger 9 transaction:\n${errors.join('\n')}`);
}

/**
 * Local check of a connector `signData` result: the signed bytes must be the
 * spec's `midnight_signed_message:<len>:` prefix plus the payload, and the
 * BIP-340 signature must verify against the returned key.
 */
export function verifySignedData(
  payload: Uint8Array,
  result: { data: string; signature: string; verifyingKey: string },
): { prefixOk: boolean; signatureOk: boolean; signedText: string } {
  const signed = fromHex(result.data);
  const expected = new Uint8Array([...new TextEncoder().encode(`midnight_signed_message:${payload.length}:`), ...payload]);
  const prefixOk = signed.length === expected.length && signed.every((byte, i) => byte === expected[i]);
  let signatureOk = false;
  try {
    signatureOk = ledger.verifySignature(
      { tag: 'schnorr', value: result.verifyingKey.replace(/^0x/i, '') },
      signed,
      { tag: 'schnorr', value: result.signature.replace(/^0x/i, '') },
    );
  } catch {
    signatureOk = false;
  }
  return { prefixOk, signatureOk, signedText: new TextDecoder('utf-8', { fatal: false }).decode(signed) };
}
