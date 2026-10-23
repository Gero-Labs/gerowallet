/**
 * Checks on Midnight transactions Nexus builds for the wallet, made before the
 * wallet signs them.
 *
 * The wallet signs an intent's whole segment, which authorizes every one of
 * its unshielded inputs it owns. A Nexus that pays one of the wallet's inputs to
 * someone else would therefore get it signed unless the wallet checks the
 * transaction against what the user asked for:
 *
 * - {@link verifyMidnightTransfer}: an unshielded send. Every requested output
 *   (recipient, token, amount) is present, every other output pays the wallet
 *   (change), every unshielded input is the wallet's own, and nothing else is
 *   in it (no shielded offer, no contract call, no DUST action).
 * - {@link verifyMidnightDustRegistration}: a native NIGHT registration for
 *   DUST. Its registrations name the wallet's own NIGHT key and the DUST address
 *   the user chose, its unshielded inputs and outputs are all the wallet's, and
 *   no NIGHT leaves (per token, outputs equal inputs).
 *
 * Pure and ledger-agnostic: a ledger-8 or ledger-9 transaction both fit the
 * structural view (ledger 9 wraps a verifying key as `{ tag, value }`).
 */

// Ledger-8 codecs are static: WalletBg imports this module, and in the background's
// single iife an inlined `await import()` of this package reads a namespace const
// declared after it (scripts/check-bundle-tdz.mjs). Ledger 9's stays lazy.
import { DustAddress, MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { debugLog } from '@/utils/debug';

type KeyLike = string | { value?: unknown };

interface InputView { readonly owner: KeyLike; readonly type: string; readonly value: bigint }
interface OutputView { readonly owner: string; readonly type: string; readonly value: bigint }
interface OfferView { readonly inputs: readonly InputView[]; readonly outputs: readonly OutputView[] }
interface RegistrationView { readonly nightKey: KeyLike; readonly dustAddress: bigint | undefined }
interface IntentView {
  readonly guaranteedUnshieldedOffer?: OfferView;
  readonly fallibleUnshieldedOffer?: OfferView;
  readonly actions?: readonly unknown[];
  readonly dustActions?: { readonly registrations: readonly RegistrationView[]; readonly spends: readonly unknown[] };
}
export interface MidnightTxView {
  readonly intents?: ReadonlyMap<number, unknown>;
  readonly guaranteedOffer?: unknown;
  readonly fallibleOffer?: ReadonlyMap<number, unknown>;
}

export type MidnightBuiltTxViolation =
  | 'missingOutput'
  | 'foreignOutput'
  | 'foreignInput'
  | 'shieldedOffer'
  | 'contractAction'
  | 'dustAction'
  | 'noRegistration'
  | 'registrationMismatch'
  | 'valueNotPreserved';

export interface MidnightIntendedOutput {
  /** The recipient's `UserAddress`, hex. */
  recipientHex: string;
  /** Raw token type, hex (all zeros for NIGHT). */
  tokenRaw: string;
  amount: bigint;
}

export interface MidnightOwnKeys {
  /** The wallet's NightExternal verifying key, hex. */
  ownKeyHex: string;
  /** The wallet's unshielded `UserAddress`, hex. */
  ownAddressHex: string;
}

const lower = (s: string) => s.toLowerCase();
const keyHex = (key: KeyLike): string =>
  lower(typeof key === 'string' ? key : String((key as { value?: unknown })?.value ?? ''));

function intentsOf(tx: MidnightTxView): IntentView[] {
  return [...(tx.intents?.values() ?? [])] as IntentView[];
}

function offersOf(intent: IntentView): OfferView[] {
  return [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer].filter((o): o is OfferView => !!o);
}

/** Checks every unshielded transaction from Nexus shares: no shielded part, no contract call, own inputs only. */
function commonViolations(tx: MidnightTxView, own: MidnightOwnKeys, into: Set<MidnightBuiltTxViolation>): void {
  if (tx.guaranteedOffer || (tx.fallibleOffer && tx.fallibleOffer.size > 0)) into.add('shieldedOffer');
  const ownKey = lower(own.ownKeyHex);
  for (const intent of intentsOf(tx)) {
    if ((intent.actions?.length ?? 0) > 0) into.add('contractAction');
    for (const offer of offersOf(intent)) {
      for (const input of offer.inputs) if (keyHex(input.owner) !== ownKey) into.add('foreignInput');
    }
  }
}

/** Every way `tx` departs from an unshielded send of `outputs`; empty when it is exactly that. */
export function verifyMidnightTransfer(
  tx: MidnightTxView,
  own: MidnightOwnKeys,
  outputs: readonly MidnightIntendedOutput[],
): MidnightBuiltTxViolation[] {
  const violations = new Set<MidnightBuiltTxViolation>();
  commonViolations(tx, own, violations);
  const ownAddress = lower(own.ownAddressHex);

  const all: OutputView[] = [];
  for (const intent of intentsOf(tx)) {
    const dust = intent.dustActions;
    if (dust && (dust.registrations.length > 0 || dust.spends.length > 0)) violations.add('dustAction');
    for (const offer of offersOf(intent)) all.push(...offer.outputs);
  }

  const used = new Set<number>();
  for (const want of outputs) {
    const index = all.findIndex((o, i) => !used.has(i)
      && lower(o.owner) === lower(want.recipientHex)
      && lower(o.type) === lower(want.tokenRaw)
      && o.value === want.amount);
    if (index < 0) violations.add('missingOutput');
    else used.add(index);
  }
  all.forEach((o, i) => {
    if (!used.has(i) && lower(o.owner) !== ownAddress) violations.add('foreignOutput');
  });
  return [...violations];
}

/**
 * Every way `tx` departs from a native NIGHT registration of the wallet's own
 * NIGHT for `dustPublicKey`; empty when it is exactly that. DUST spends are
 * tolerated: spending DUST needs that DUST's secret, which never leaves the
 * wallet, so a spend in Nexus's build can only be paid from Nexus's own DUST.
 */
export function verifyMidnightDustRegistration(
  tx: MidnightTxView,
  own: MidnightOwnKeys,
  dustPublicKey: bigint,
): MidnightBuiltTxViolation[] {
  const violations = new Set<MidnightBuiltTxViolation>();
  commonViolations(tx, own, violations);
  const ownKey = lower(own.ownKeyHex);
  const ownAddress = lower(own.ownAddressHex);

  let registrations = 0;
  const net = new Map<string, bigint>();
  for (const intent of intentsOf(tx)) {
    for (const reg of intent.dustActions?.registrations ?? []) {
      registrations++;
      if (keyHex(reg.nightKey) !== ownKey || reg.dustAddress !== dustPublicKey) violations.add('registrationMismatch');
    }
    for (const offer of offersOf(intent)) {
      for (const input of offer.inputs) net.set(lower(input.type), (net.get(lower(input.type)) ?? 0n) + input.value);
      for (const output of offer.outputs) {
        if (lower(output.owner) !== ownAddress) violations.add('foreignOutput');
        net.set(lower(output.type), (net.get(lower(output.type)) ?? 0n) - output.value);
      }
    }
  }
  if (registrations === 0) violations.add('noRegistration');
  for (const value of net.values()) if (value !== 0n) violations.add('valueNotPreserved');
  return [...violations];
}

/** Thrown before signing when a Nexus-built Midnight transaction is not what was asked for. Nothing was signed. */
export const MIDNIGHT_BUILT_TX_MISMATCH = 'MIDNIGHT_BUILT_TX_MISMATCH';

function refuse(what: string, detail: unknown): never {
  debugLog(`Midnight ${what}: refused a Nexus-built transaction`, detail);
  throw new Error(MIDNIGHT_BUILT_TX_MISMATCH);
}

/**
 * Throws {@link MIDNIGHT_BUILT_TX_MISMATCH} unless `unprovenTxHex` is exactly the
 * unshielded send `requested` (the outputs of the wallet's build request).
 * Anything that cannot be decoded is refused rather than signed blind.
 */
export async function assertMidnightTransferMatches(
  sdkNetworkId: string,
  unprovenTxHex: string,
  own: MidnightOwnKeys,
  requested: ReadonlyArray<{ address: string; amount: string; token: string }>,
): Promise<void> {
  let violations: MidnightBuiltTxViolation[];
  try {
    const decode = await midnightAddressDecoder(sdkNetworkId);
    const outputs = requested.map((o) => {
      if (!/^[0-9]+$/.test(String(o.amount))) throw new Error('Invalid amount');
      return { recipientHex: decode.unshieldedHex(o.address), tokenRaw: rawTokenOf(o.token), amount: BigInt(o.amount) };
    });
    violations = verifyMidnightTransfer(await decodeUnprovenMidnightTransaction(sdkNetworkId, unprovenTxHex), own, outputs);
  } catch (e) {
    return refuse('send', e);
  }
  if (violations.length > 0) refuse('send', violations);
}

/**
 * Throws {@link MIDNIGHT_BUILT_TX_MISMATCH} unless `unprovenTxHex` is a native
 * NIGHT registration of the wallet's own NIGHT for `dustReceiverBech32`.
 */
export async function assertMidnightDustRegistrationMatches(
  sdkNetworkId: string,
  unprovenTxHex: string,
  own: MidnightOwnKeys,
  dustReceiverBech32: string,
): Promise<void> {
  let violations: MidnightBuiltTxViolation[];
  try {
    const dustKey = (await midnightAddressDecoder(sdkNetworkId)).dustPublicKey(dustReceiverBech32);
    violations = verifyMidnightDustRegistration(await decodeUnprovenMidnightTransaction(sdkNetworkId, unprovenTxHex), own, dustKey);
  } catch (e) {
    return refuse('DUST registration', e);
  }
  if (violations.length > 0) refuse('DUST registration', violations);
}

/** Decode an unproven transaction under `sdkNetworkId`'s ledger and prove it belongs to that network. */
export async function decodeUnprovenMidnightTransaction(sdkNetworkId: string, hex: string): Promise<MidnightTxView> {
  const { midnightLedgerVersion, strictMidnightHex } = await import('./midnightLedger');
  if (midnightLedgerVersion(sdkNetworkId) === 9) {
    const { deserializeLedger9Transaction } = await import('./midnightLedger9');
    return deserializeLedger9Transaction(sdkNetworkId, hex) as unknown as MidnightTxView;
  }
  const ledger = await import('@midnight-ntwrk/ledger-v8');
  const tx: import('@midnight-ntwrk/ledger-v8').UnprovenTransaction =
    ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', strictMidnightHex(hex));
  // The ledger refuses to merge transactions of different networks.
  ledger.Transaction.fromParts(sdkNetworkId.toLowerCase()).merge(tx);
  return tx as unknown as MidnightTxView;
}

/** Bech32m → ledger values for `sdkNetworkId`, with the address format of its ledger. */
export async function midnightAddressDecoder(sdkNetworkId: string): Promise<{
  unshieldedHex(bech32: string): string;
  dustPublicKey(bech32: string): bigint;
}> {
  const { midnightLedgerVersion } = await import('./midnightLedger');
  const id = sdkNetworkId.toLowerCase();
  if (midnightLedgerVersion(sdkNetworkId) === 9) {
    const f = await import('midnight-v9-address-format');
    return {
      unshieldedHex: (bech32) => lower(f.UnshieldedAddress.codec.decode(id, f.MidnightBech32m.parse(bech32)).hexString),
      dustPublicKey: (bech32) => f.DustAddress.codec.decode(id, f.MidnightBech32m.parse(bech32)).data,
    };
  }
  return {
    unshieldedHex: (bech32) => lower(UnshieldedAddress.codec.decode(id, MidnightBech32m.parse(bech32)).hexString),
    dustPublicKey: (bech32) => DustAddress.codec.decode(id, MidnightBech32m.parse(bech32)).data,
  };
}

/** The raw token type a send request names: `NIGHT`, or a 32-byte colour as hex. */
export function rawTokenOf(token: string): string {
  if (token === 'NIGHT') return '0'.repeat(64);
  if (!/^[0-9a-fA-F]{64}$/.test(token)) throw new Error('Invalid Midnight token type');
  return lower(token);
}
