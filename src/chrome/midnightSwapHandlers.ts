// The worker's side of the Midnight P2P swap (MessageTypes.MIDNIGHT_SWAP_*).
// Extension pages only (senderTrust.ts), the logged Midnight wallet only, and
// only on a network of MIDNIGHT_SWAP_NETWORKS whose chain runs ledger 9.
//
// The page sends intent (what to give, what to want, which offer); the worker
// picks every coin from the LOGGED wallet's own sync and reads every figure it
// acts on from the offer's bytes, never from the request:
//
//   MAKE      makeIntent with payFees false (no DUST, no proof): the sealed
//             offer, its MIP-0005 string, and a record (midnightSwapRecords.ts).
//   INSPECT   the taker's view of an offer string: what they pay and get, the
//             expiry, the other wallet, and why it cannot be taken, if so.
//   TAKE      inspect again, refuse unless the terms are the ones the page
//             showed, then balanceSealedTransaction (PR 1616: the wallet's
//             inputs, the DUST fee, proof on this device) and submit-proven.
//   WITHDRAW  a self-send of exactly the offered coins (the fee paid in DUST),
//             which spends them and so voids the offer.
//   LIST      the wallet's offers, statuses re-read against its coins.
//
// An offer with a private (shielded) leg goes through midnightPrivateSwap9.ts
// instead (MIDNIGHT_SWAP_PRIVATE_LEGS): MAKE builds it with Zswap proofs (no
// fee), INSPECT describes it with describePrivateSwapOffer9 (its `taker` is
// what the page shows and sends back as `expect`), TAKE builds the mirror and
// pays the fee. A fully private offer has no TTL: its expiry is an estimate
// from when this worker first saw it (`expiry: 'root-window'`). Its private
// coins are watched through the private sync (midnightPrivateCoins.ts).
//
// Answers `{ success: false, error }` with a MidnightSwapCode where the reason
// is the swap's, else the error's own code or message (midnight-tx.service maps
// the DUST and ledger codes). PRIVACY: never log offer strings, tx bytes or keys.

import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain } from '@/models/types';
import { SENDER, TARGET } from '@/chrome/config';
import { walletManager } from '@/services/walletManager.service';
import { walletStore } from '@/stores/walletStore';
import { midnightActions, midnightStore } from '@/stores/midnightStore';
import { getMidnightApi } from '@/api/midnight-api';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { buildFailureReply } from '@/chains/midnight/midnightBuildFailure';
import { resolveMidnightLedger } from '@/chains/midnight/midnightChainLedger';
import { midnightSdkNetworkId } from '@/chains/midnight/midnightSdkNetwork';
import { midnightTxIdentifiers } from '@/chains/midnight/midnightTxIdentifiers';
import { finalizedLedgerTxHash, historyHashForSubmittedTx } from '@/chains/midnight/midnightTxHash';
import { midnightWriteBlock } from '@/chains/midnight/midnightWriteGate';
import { unshieldedAddressCodec } from '@/chains/midnight/midnightConnectorBalance';
import {
  connectorIntentSyncReady, IntentInsufficientFundsError, MIDNIGHT_WALLET_NOT_SYNCED, NIGHT_RAW_TOKEN_TYPE,
  uncoveredIntentInput, validateConnectorIntentRequest,
} from '@/chains/midnight/midnightConnectorIntent';
import { decodeSealedTransaction9, sealedSelectableUtxos } from '@/chains/midnight/midnightSealedBalancer9';
import type { SealedTransaction9 } from '@/chains/midnight/midnightDustSpread9';
import {
  isMidnightSwapNetwork, isMidnightSwapTtl, MIDNIGHT_SWAP_MIN_TAKE_MS, MIDNIGHT_SWAP_PRIVATE_LEGS, MidnightSwapError,
  privateSwapRefusalCode, type MidnightSwapCode,
} from '@/chains/midnight/midnightSwapConfig';
import { encodeSwapOffer, SwapOfferFormatError } from '@/chains/midnight/midnightSwapOffer';
import {
  readSwapOffer9, sameSwapLegs, swapOfferFacts9, SwapOfferWrongNetworkError, swapTakeRefusal, type SwapOfferFacts9,
} from '@/chains/midnight/midnightSwap9';
import {
  utxoRef, withoutReservedCoins, type MidnightSwapCoinView, type MidnightSwapLeg, type MidnightSwapOfferRecord,
} from '@/chains/midnight/midnightSwapRecords';
import {
  describePrivateSwapOffer9, PrivateSwapRefusedError, validatePrivateSwapTerms, type PrivateSwapLeg,
} from '@/chains/midnight/midnightPrivateSwap9';
import { midnightPrivateCoins } from '@/chains/midnight/midnightPrivateCoins';
import {
  loadSwapOffers, reservedSwapCoinsFor, reservedSwapNullifiersFor, saveSwapOffer, updateSwapOffer,
} from '@/chrome/midnightSwapOfferStore';
import type { WalletBg } from '@/chrome/walletBg';

type Controller = ReturnType<typeof Messaging.createBackgroundController>;
type Request = Parameters<Parameters<Controller['addToOptions']>[1]>[0];

const HEX64 = /^[0-9a-f]{64}$/;
const DECIMAL = /^[0-9]{1,80}$/;

/** What the taker pays and gets, as the INSPECT answer and the TAKE check carry them. */
export interface SwapTakeTerms {
  readonly pay: MidnightSwapLeg[];
  readonly get: MidnightSwapLeg[];
}

/** The INSPECT answer. */
export interface SwapOfferInspection extends SwapTakeTerms {
  readonly offerId: string;
  readonly expiresAt: number | null;
  /**
   * `root-window`: `expiresAt` is an estimate (a fully private offer has no
   * TTL; it lives while the chain keeps its Merkle root). Absent: the TTL.
   */
  readonly expiry?: 'ttl' | 'root-window';
  /** The other wallet, bech32m (the first recipient of the offer's public outputs); null when it pays none. */
  readonly maker: string | null;
  /** The offer has a private (shielded) leg. */
  readonly private?: boolean;
  /** Why this wallet cannot take it now, if so. */
  readonly refusal?: MidnightSwapCode;
}

/** The logged Midnight wallet, if the swap is offered for it (network gate + ledger 9). */
async function swapWallet(): Promise<{ wallet: WalletBg; sdkNetworkId: string }> {
  const wallet = walletManager.getWallet();
  if (!wallet || wallet.chain !== Blockchain.MIDNIGHT) throw new MidnightSwapError('SWAP_UNAVAILABLE');
  if (!isMidnightSwapNetwork(wallet.network)) throw new MidnightSwapError('SWAP_UNAVAILABLE');
  if (walletStore.isLocked) throw new Error('Wallet is locked');
  if (await resolveMidnightLedger(wallet.network) !== 9) throw new MidnightSwapError('SWAP_UNAVAILABLE');
  return { wallet, sdkNetworkId: midnightSdkNetworkId(wallet.network) };
}

/** A request's fields, each still unread. */
type RequestData = Partial<Record<'give' | 'want' | 'ttlMinutes' | 'offer' | 'expect' | 'offerId' | 'password' | 'prfSecret', unknown>>;

function readCredential(data: RequestData): { password?: string; prfBytes?: Uint8Array } {
  const { password, prfSecret } = data;
  if (password !== undefined && typeof password !== 'string') throw new Error('Invalid spending password');
  if (prfSecret !== undefined && (!Array.isArray(prfSecret) || prfSecret.length !== 32
    || !prfSecret.every((byte: unknown) => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255))) {
    throw new Error('Invalid PassKey authorization');
  }
  return { password: password as string | undefined, prfBytes: prfSecret ? new Uint8Array(prfSecret as number[]) : undefined };
}

function readLeg(value: unknown): MidnightSwapLeg {
  const leg = value as { tokenType?: unknown; amount?: unknown; shielded?: unknown } | null;
  const tokenType = typeof leg?.tokenType === 'string' ? leg.tokenType.toLowerCase() : '';
  const amount = typeof leg?.amount === 'string' ? leg.amount : '';
  if (!HEX64.test(tokenType) || !DECIMAL.test(amount) || BigInt(amount) === 0n) throw new Error('Invalid token or amount');
  if (leg?.shielded !== undefined && typeof leg.shielded !== 'boolean') throw new Error('Invalid token or amount');
  if (leg?.shielded !== true) return { tokenType, amount };
  if (!MIDNIGHT_SWAP_PRIVATE_LEGS) throw new MidnightSwapError('SWAP_OFFER_UNSUPPORTED');
  if (tokenType === NIGHT_RAW_TOKEN_TYPE) throw new MidnightSwapError(privateSwapRefusalCode('shieldedNight'));
  return { tokenType, amount, shielded: true };
}

const toPrivateLeg = (leg: MidnightSwapLeg): PrivateSwapLeg =>
  ({ kind: leg.shielded ? 'shielded' : 'unshielded', type: leg.tokenType, value: leg.amount });
const fromPrivateLeg = (leg: PrivateSwapLeg): MidnightSwapLeg =>
  (leg.kind === 'shielded' ? { tokenType: leg.type, amount: leg.value, shielded: true } : { tokenType: leg.type, amount: leg.value });

/** What the records read a status from: the public coins, and the private ones while the private sync has a complete state. */
function swapCoinView(): MidnightSwapCoinView {
  return { lastSync: midnightStore.lastSync, utxos: midnightStore.utxos, privateCoins: midnightPrivateCoins(midnightStore.activeWalletKey) };
}

/** The private balance of `tokenType`, when the private sync has a complete state. */
function privateBalance(tokenType: string): bigint | undefined {
  if (midnightStore.privateSyncStatus !== 'synced') return undefined;
  return midnightStore.balances.shieldedTokens[tokenType.toLowerCase()] ?? 0n;
}

/**
 * When this worker first saw each private offer (by offer id): a fully private
 * offer has no TTL, and an expiry estimated from first sight errs early, never
 * late (describePrivateSwapOffer9). Worker memory; a restart sees it anew.
 */
const firstSeen = new Map<string, number>();
const FIRST_SEEN_MAX = 200;
function noteSeen(offerId: string, now: number): number {
  const seen = firstSeen.get(offerId);
  if (seen !== undefined) return seen;
  if (firstSeen.size >= FIRST_SEEN_MAX) firstSeen.delete(firstSeen.keys().next().value as string);
  firstSeen.set(offerId, now);
  return now;
}

/** The swap code for an error a private build or take throws, if it has one. */
function privateSwapCodeOf(error: unknown): MidnightSwapCode | undefined {
  if (error instanceof PrivateSwapRefusedError) return privateSwapRefusalCode(error.code);
  if (error instanceof IntentInsufficientFundsError) return 'SWAP_INSUFFICIENT_FUNDS';
  return undefined;
}

function readLegs(value: unknown): MidnightSwapLeg[] {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('Invalid terms');
  return value.map(readLeg);
}

/** The synced unshielded address of the logged wallet, or a refusal before anything is unlocked. */
function syncedOwnAddress(): string {
  const own = midnightStore.addresses.unshielded;
  if (!connectorIntentSyncReady(midnightStore) || typeof own !== 'string' || !own) throw new Error(MIDNIGHT_WALLET_NOT_SYNCED);
  return own;
}

/** Decode an offer string, mapping format problems to swap codes. */
function readOffer(offer: unknown, sdkNetworkId: string): { facts: SwapOfferFacts9; hex: string; tx: SealedTransaction9 } {
  if (typeof offer !== 'string') throw new MidnightSwapError('SWAP_OFFER_UNREADABLE');
  try {
    const { tx, bytes } = readSwapOffer9(offer, sdkNetworkId);
    return { facts: swapOfferFacts9(tx, bytes), hex: Buffer.from(bytes).toString('hex'), tx };
  } catch (error) {
    if (error instanceof SwapOfferWrongNetworkError) throw new MidnightSwapError('SWAP_OFFER_WRONG_NETWORK');
    if (error instanceof SwapOfferFormatError) throw new MidnightSwapError('SWAP_OFFER_UNREADABLE');
    throw error;
  }
}

/** The bech32m address of the offer's first public payee, or null. */
function makerAddress(facts: SwapOfferFacts9, codec: Awaited<ReturnType<typeof unshieldedAddressCodec>>): string | null {
  const payee = facts.payees[0];
  if (!payee) return null;
  try {
    return codec.toBech32(payee);
  } catch {
    return null;
  }
}

/**
 * The taker's view of an offer with a private leg: describePrivateSwapOffer9's
 * `taker` (what the page shows and sends back), the expiry (an estimate for a
 * fully private offer) and why this wallet cannot take it now. Throws the
 * offer's refusal when it is not a swap this wallet takes at all.
 */
async function inspectPrivate(
  read: { facts: SwapOfferFacts9; hex: string; tx: SealedTransaction9 }, wallet: WalletBg, sdkNetworkId: string,
): Promise<{ inspection: SwapOfferInspection; hex: string }> {
  const { facts, hex, tx } = read;
  const now = Date.now();
  const preview = describePrivateSwapOffer9(hex, sdkNetworkId, { now, seenAt: noteSeen(facts.offerId, now) });
  if (preview.ok === false) throw new MidnightSwapError(privateSwapRefusalCode(preview.code));
  const own = syncedOwnAddress();
  const codec = await unshieldedAddressCodec(sdkNetworkId);
  const pay = preview.taker.gives.map(fromPrivateLeg);
  const get = preview.taker.receives.map(fromPrivateLeg);
  const expiresAt = preview.expiresAt ?? null;
  let refusal: MidnightSwapCode | undefined;
  // This wallet's own offer: a record of it, a public coin of its own, or a private coin it still holds.
  const records = await loadSwapOffers(wallet.network, wallet.id, swapCoinView());
  const offerNullifiers = (tx.guaranteedOffer?.inputs ?? []).map(input => input.nullifier.toLowerCase());
  const heldPrivate = midnightPrivateCoins(midnightStore.activeWalletKey)?.nullifiers;
  if (records.some(record => record.offerId === facts.offerId)
    || facts.inputOwners.includes(codec.toHex(own).toLowerCase())
    || (heldPrivate && offerNullifiers.some(nullifier => heldPrivate.has(nullifier)))) {
    refusal = 'SWAP_OFFER_OWN';
  } else if (expiresAt === null || expiresAt - now < MIDNIGHT_SWAP_MIN_TAKE_MS) {
    refusal = 'SWAP_OFFER_EXPIRED';
  } else {
    const reserved = await reservedSwapCoinsFor(wallet.network, wallet.id);
    const selectable = withoutReservedCoins(sealedSelectableUtxos(hex, sdkNetworkId, midnightStore.utxos), reserved);
    const publicPay = pay.filter(leg => !leg.shielded).map(leg => ({ type: leg.tokenType, value: leg.amount }));
    const short = (publicPay.length && uncoveredIntentInput(publicPay, { lastSync: midnightStore.lastSync, utxos: selectable }))
      || pay.some(leg => leg.shielded && (privateBalance(leg.tokenType) ?? BigInt(leg.amount)) < BigInt(leg.amount));
    if (short) refusal = 'SWAP_INSUFFICIENT_FUNDS';
  }
  return {
    hex,
    inspection: {
      offerId: facts.offerId,
      pay,
      get,
      expiresAt,
      expiry: preview.expiry === 'root-window' ? 'root-window' : 'ttl',
      maker: makerAddress(facts, codec),
      private: true,
      refusal,
    },
  };
}

/** The taker's view of `offer` for the logged wallet. Throws only when it is not an offer at all. */
async function inspect(offer: unknown, wallet: WalletBg, sdkNetworkId: string): Promise<{ inspection: SwapOfferInspection; hex: string }> {
  const read = readOffer(offer, sdkNetworkId);
  if (read.facts.unsupported === 'shielded' && MIDNIGHT_SWAP_PRIVATE_LEGS) return inspectPrivate(read, wallet, sdkNetworkId);
  const { facts, hex } = read;
  const own = syncedOwnAddress();
  const codec = await unshieldedAddressCodec(sdkNetworkId);
  const ownHex = codec.toHex(own);
  let refusal = swapTakeRefusal(facts, ownHex, Date.now());
  if (!refusal) {
    // The coins the taker's wallet may select: not the offer's own, not those of the taker's open offers.
    const reserved = await reservedSwapCoinsFor(wallet.network, wallet.id);
    const selectable = withoutReservedCoins(sealedSelectableUtxos(hex, sdkNetworkId, midnightStore.utxos), reserved);
    const short = uncoveredIntentInput(facts.makerWants.map(leg => ({ type: leg.tokenType, value: leg.amount })),
      { lastSync: midnightStore.lastSync, utxos: selectable });
    if (short) refusal = 'SWAP_INSUFFICIENT_FUNDS';
  }
  return {
    hex,
    inspection: {
      offerId: facts.offerId,
      pay: facts.makerWants,
      get: facts.makerGives,
      expiresAt: facts.expiresAt,
      maker: makerAddress(facts, codec),
      refusal,
    },
  };
}

/**
 * Submit a sealed transaction through submit-proven; the hash history shows.
 * submit-proven answers the extrinsic hash only, so the ledger hash (the one
 * the indexer and history use) is read from the bytes themselves.
 */
async function submitSealed(network: string, sdkNetworkId: string, sealedHex: string): Promise<string> {
  const watch = { identifiers: await midnightTxIdentifiers(sealedHex, network, true) };
  const submitted = await getMidnightApi(network).submitProvenMidnightTx({ signedTxHex: sealedHex, waitFor: 'Submitted' }, watch);
  let ledgerTxHash: string | undefined;
  try {
    ledgerTxHash = finalizedLedgerTxHash(decodeSealedTransaction9(sealedHex, sdkNetworkId));
  } catch {
    ledgerTxHash = undefined;
  }
  return historyHashForSubmittedTx({ txHash: submitted.txHash, ledgerTxHash: submitted.ledgerTxHash ?? ledgerTxHash });
}

/**
 * The node's refusal of a transaction whose inputs are no longer there: the
 * maker spent or withdrew them, or someone else took the offer first.
 */
const INPUTS_GONE = /(?:already spent|double.?spend|input.*not.*(?:found|in.*utxo)|unknown.*utxo|no such utxo|InputNotInUtxos|nullifier.*(?:already|present|spent|exists))/i;

/** One maker at a time: a second offer must not select the coins the first is still being built from. */
let makeQueue: Promise<unknown> = Promise.resolve();

/** Offers with a withdrawal being built or submitted: a second one (a double click) is refused at once. */
const withdrawing = new Set<string>();

function reply(request: Request, sendResponse: (response?: unknown) => void, data: Record<string, unknown>): void {
  sendResponse({ id: request.id, data, target: TARGET, sender: SENDER.extension });
}

function replyError(request: Request, sendResponse: (response?: unknown) => void, error: unknown): void {
  const code = error instanceof MidnightSwapError ? error.code : privateSwapCodeOf(error);
  reply(request, sendResponse, {
    success: false,
    error: code ?? getErrorMessage(error),
    ...(code ? {} : buildFailureReply(error)),
  });
}

/**
 * Make an offer with a private leg (midnightPrivateSwap9.ts): Zswap proofs, no
 * fee, the record read back from the sealed bytes. A fully private offer has
 * no TTL (its expiry is the estimate the builder returns), so `ttlMinutes`
 * bounds only an offer with a public leg.
 */
async function makePrivateOffer(args: {
  wallet: WalletBg; sdkNetworkId: string; own: string; give: MidnightSwapLeg; want: MidnightSwapLeg; ttlMinutes: number;
  credential: { password?: string; prfBytes?: Uint8Array };
}): Promise<MidnightSwapOfferRecord> {
  const { wallet, sdkNetworkId, own, give, want, credential } = args;
  const network = wallet.network;
  const validated = validatePrivateSwapTerms({ gives: [toPrivateLeg(give)], wants: [toPrivateLeg(want)] });
  if (validated.ok === false) throw new MidnightSwapError(privateSwapRefusalCode(validated.code));
  if (give.shielded) {
    const balance = privateBalance(give.tokenType);
    if (balance !== undefined && balance < BigInt(give.amount)) throw new MidnightSwapError('SWAP_INSUFFICIENT_FUNDS');
  } else {
    const reserved = await reservedSwapCoinsFor(network, wallet.id);
    const short = uncoveredIntentInput([{ type: give.tokenType, value: give.amount }],
      { lastSync: midnightStore.lastSync, utxos: withoutReservedCoins(midnightStore.utxos, reserved) });
    if (short) throw new MidnightSwapError('SWAP_INSUFFICIENT_FUNDS');
  }
  const hasPublic = !give.shielded || !want.shielded;
  const createdAt = Date.now();
  let built;
  try {
    built = await wallet.buildMidnightPrivateSwapOffer({
      terms: validated.terms,
      ttl: hasPublic ? new Date(createdAt + args.ttlMinutes * 60_000) : undefined,
      avoidNullifiers: [...await reservedSwapNullifiersFor(network, wallet.id)],
      onProving: () => midnightActions.setSendProgress({ phase: 'proving', percent: -1 }),
    }, credential.password, credential.prfBytes);
  } finally {
    midnightActions.setSendProgress(null);
  }
  // Every figure of the record is read back from the sealed bytes.
  const bytes = Uint8Array.from(Buffer.from(built.offerHex, 'hex'));
  const facts = swapOfferFacts9(decodeSealedTransaction9(built.offerHex, sdkNetworkId), bytes);
  const gives = built.terms.gives.map(fromPrivateLeg);
  const wants = built.terms.wants.map(fromPrivateLeg);
  if (!sameSwapLegs(gives, [give]) || !sameSwapLegs(wants, [want])
    || facts.intentHashes.length !== (hasPublic ? 1 : 0) || (built.nullifiers.length > 0) !== !!give.shielded) {
    throw new Error('The sealed offer is not the one requested');
  }
  const record: MidnightSwapOfferRecord = {
    offerId: facts.offerId,
    offer: encodeSwapOffer(bytes),
    network,
    owner: own,
    gives,
    wants,
    createdAt,
    expiresAt: built.expiresAt,
    expiry: built.expiry,
    inputs: facts.inputs,
    intentHash: facts.intentHashes[0] ?? '',
    nullifiers: [...built.nullifiers],
    commitments: [...built.commitments],
    status: 'open',
  };
  await saveSwapOffer(wallet.id, record);
  return record;
}

export function registerMidnightSwapHandlers(app: Controller): void {
  app.addToOptions(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, async (request, sendResponse) => {
    let prfBytes: Uint8Array | undefined;
    try {
      const { wallet, sdkNetworkId } = await swapWallet();
      const data = (request.data ?? {}) as RequestData;
      const give = readLeg(data.give);
      const want = readLeg(data.want);
      if (give.tokenType === want.tokenType) throw new Error('An offer must swap two different tokens');
      if (!isMidnightSwapTtl(data.ttlMinutes)) throw new Error('Invalid offer expiry');
      const ttlMinutes = data.ttlMinutes;
      const credential = readCredential(data);
      prfBytes = credential.prfBytes;
      const own = syncedOwnAddress();
      const network = wallet.network;
      const run = makeQueue.catch(() => undefined).then(async () => {
        if (give.shielded || want.shielded) {
          if (await midnightWriteBlock(network)) throw new MidnightSwapError('SWAP_UNAVAILABLE');
          return makePrivateOffer({ wallet, sdkNetworkId, own, give, want, ttlMinutes, credential });
        }
        const reserved = await reservedSwapCoinsFor(network, wallet.id);
        const short = uncoveredIntentInput([{ type: give.tokenType, value: give.amount }],
          { lastSync: midnightStore.lastSync, utxos: withoutReservedCoins(midnightStore.utxos, reserved) });
        if (short) throw new MidnightSwapError('SWAP_INSUFFICIENT_FUNDS');
        const validation = validateConnectorIntentRequest({
          desiredInputs: [{ kind: 'unshielded', type: give.tokenType, value: give.amount }],
          desiredOutputs: [{ kind: 'unshielded', type: want.tokenType, value: want.amount, recipient: own }],
          // The taker pays the fee: nothing is proved and no DUST is spent here.
          options: { intentId: 'random', payFees: false },
        }, network);
        if (validation.ok === false) throw new Error(validation.reason);
        const { ok: _ok, ...intentRequest } = validation;
        const createdAt = Date.now();
        const built = await wallet.buildMidnightConnectorIntent(intentRequest, credential.password, prfBytes, {
          ttl: new Date(createdAt + ttlMinutes * 60_000),
        });
        // Every figure of the record is read back from the sealed bytes.
        const bytes = Uint8Array.from(Buffer.from(built.tx, 'hex'));
        const facts = swapOfferFacts9(decodeSealedTransaction9(built.tx, sdkNetworkId), bytes);
        if (!sameSwapLegs(facts.makerGives, [give]) || !sameSwapLegs(facts.makerWants, [want])
          || facts.expiresAt === null || facts.intentHashes.length !== 1) {
          throw new Error('The sealed offer is not the one requested');
        }
        const record: MidnightSwapOfferRecord = {
          offerId: facts.offerId,
          offer: encodeSwapOffer(bytes),
          network,
          owner: own,
          gives: facts.makerGives,
          wants: facts.makerWants,
          createdAt,
          expiresAt: facts.expiresAt,
          inputs: facts.inputs,
          intentHash: facts.intentHashes[0],
          status: 'open',
        };
        await saveSwapOffer(wallet.id, record);
        return record;
      });
      makeQueue = run;
      const record = await run;
      reply(request, sendResponse, { success: true, record });
    } catch (error) {
      replyError(request, sendResponse, error);
    } finally {
      prfBytes?.fill(0);
    }
  });

  app.addToOptions(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, async (request, sendResponse) => {
    try {
      const { wallet, sdkNetworkId } = await swapWallet();
      const { inspection } = await inspect((request.data as { offer?: unknown } | undefined)?.offer, wallet, sdkNetworkId);
      reply(request, sendResponse, { success: true, inspection });
    } catch (error) {
      replyError(request, sendResponse, error);
    }
  });

  app.addToOptions(MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER, async (request, sendResponse) => {
    let prfBytes: Uint8Array | undefined;
    try {
      const { wallet, sdkNetworkId } = await swapWallet();
      const data = (request.data ?? {}) as RequestData;
      const expect = data.expect as { pay?: unknown; get?: unknown } | undefined;
      const expected: SwapTakeTerms = { pay: readLegs(expect?.pay), get: readLegs(expect?.get) };
      const credential = readCredential(data);
      prfBytes = credential.prfBytes;
      if (await midnightWriteBlock(wallet.network)) throw new MidnightSwapError('SWAP_UNAVAILABLE');
      // Again, right before anything is unlocked: the coins and the clock may have moved since the review.
      const { inspection, hex } = await inspect(data.offer, wallet, sdkNetworkId);
      if (inspection.refusal) throw new MidnightSwapError(inspection.refusal);
      if (!sameSwapLegs(inspection.pay, expected.pay) || !sameSwapLegs(inspection.get, expected.get)) {
        throw new MidnightSwapError('SWAP_OFFER_CHANGED');
      }
      const progress = {
        onDustSyncProgress: (percent: number, detail: string) => midnightActions.setSendProgress({ phase: 'syncingDust', percent, detail }),
        onProving: () => midnightActions.setSendProgress({ phase: 'proving', percent: -1 }),
      };
      let sealed: string;
      try {
        midnightActions.setSendProgress({ phase: 'syncingDust', percent: -1, detail: '' });
        if (inspection.private) {
          // What the user approved is what the page showed: describePrivateSwapOffer9's `taker`, sent back as `expect`.
          sealed = (await wallet.takeMidnightPrivateSwapOffer({
            offerHex: hex,
            approved: { gives: expected.pay.map(toPrivateLeg), receives: expected.get.map(toPrivateLeg) },
            avoidNullifiers: [...await reservedSwapNullifiersFor(wallet.network, wallet.id)],
            ...progress,
          }, credential.password, prfBytes)).txHex;
        } else {
          sealed = (await wallet.balanceMidnightConnectorTransaction(hex, credential.password, prfBytes, true, progress)).tx;
        }
      } finally {
        midnightActions.setSendProgress(null);
      }
      let txHash: string;
      try {
        txHash = await submitSealed(wallet.network, sdkNetworkId, sealed);
      } catch (error) {
        if (INPUTS_GONE.test(getErrorMessage(error))) throw new MidnightSwapError('SWAP_OFFER_GONE');
        throw error;
      }
      reply(request, sendResponse, { success: true, txHash });
    } catch (error) {
      replyError(request, sendResponse, error);
    } finally {
      prfBytes?.fill(0);
    }
  });

  app.addToOptions(MessageTypes.MIDNIGHT_SWAP_WITHDRAW_OFFER, async (request, sendResponse) => {
    let prfBytes: Uint8Array | undefined;
    let held = '';
    try {
      const { wallet, sdkNetworkId } = await swapWallet();
      const data = (request.data ?? {}) as RequestData;
      const offerId = typeof data.offerId === 'string' ? data.offerId.toLowerCase() : '';
      if (!HEX64.test(offerId)) throw new MidnightSwapError('SWAP_OFFER_UNKNOWN');
      const credential = readCredential(data);
      prfBytes = credential.prfBytes;
      const key = `${wallet.id}:${offerId}`;
      if (withdrawing.has(key)) throw new MidnightSwapError('SWAP_OFFER_NOT_OPEN');
      withdrawing.add(key);
      held = key;
      if (await midnightWriteBlock(wallet.network)) throw new MidnightSwapError('SWAP_UNAVAILABLE');
      const own = syncedOwnAddress();
      const records = await loadSwapOffers(wallet.network, wallet.id, swapCoinView());
      const record = records.find(r => r.offerId === offerId);
      if (!record) throw new MidnightSwapError('SWAP_OFFER_UNKNOWN');
      if (record.status !== 'open' || record.withdrawTxHash) throw new MidnightSwapError('SWAP_OFFER_NOT_OPEN');
      // Private coins are voided by spending them (a private Send), not by a self-send of public coins.
      if (record.nullifiers?.length || !record.inputs.length) throw new MidnightSwapError('SWAP_PRIVATE_NO_WITHDRAW');
      // Exactly the offered coins, each still held: spending them voids the offer.
      const wanted = new Set(record.inputs);
      const coins = midnightStore.utxos.filter(utxo => wanted.has(utxoRef(utxo)));
      if (coins.length !== wanted.size) throw new MidnightSwapError('SWAP_OFFER_NOT_OPEN');
      const totals = new Map<string, bigint>();
      for (const coin of coins) totals.set(coin.tokenType.toLowerCase(), (totals.get(coin.tokenType.toLowerCase()) ?? 0n) + coin.value);
      const validation = validateConnectorIntentRequest({
        desiredInputs: [...totals].map(([type, value]) => ({ kind: 'unshielded', type, value: value.toString() })),
        desiredOutputs: [...totals].map(([type, value]) => ({ kind: 'unshielded', type, value: value.toString(), recipient: own })),
        options: { intentId: 'random', payFees: true },
      }, wallet.network);
      if (validation.ok === false) throw new Error(validation.reason);
      const { ok: _ok, ...intentRequest } = validation;
      const built = await wallet.buildMidnightConnectorIntent(intentRequest, credential.password, prfBytes, { onlyCoins: wanted });
      const txHash = await submitSealed(wallet.network, sdkNetworkId, built.tx);
      // Noted after the submit. Should this write fail, the record stays open without the hash:
      // the next read finds the offered coins spent and shows it cancelled (midnightSwapRecords.ts),
      // and a second Withdraw is refused because those coins are gone.
      const updated = await updateSwapOffer(wallet.network, wallet.id, offerId, { withdrawTxHash: txHash });
      reply(request, sendResponse, { success: true, txHash, record: updated });
    } catch (error) {
      replyError(request, sendResponse, error);
    } finally {
      prfBytes?.fill(0);
      if (held) withdrawing.delete(held);
    }
  });

  app.addToOptions(MessageTypes.MIDNIGHT_SWAP_LIST_OFFERS, async (request, sendResponse) => {
    try {
      const { wallet } = await swapWallet();
      const records = await loadSwapOffers(wallet.network, wallet.id, swapCoinView());
      reply(request, sendResponse, { success: true, records });
    } catch (error) {
      replyError(request, sendResponse, error);
    }
  });

  app.addToOptions(MessageTypes.MIDNIGHT_SWAP_MARK_LISTED, async (request, sendResponse) => {
    try {
      const { wallet } = await swapWallet();
      const offerId = (request.data as { offerId?: unknown } | undefined)?.offerId;
      if (typeof offerId !== 'string' || !HEX64.test(offerId)) throw new MidnightSwapError('SWAP_OFFER_UNKNOWN');
      const record = await updateSwapOffer(wallet.network, wallet.id, offerId, { listed: true });
      if (!record) throw new MidnightSwapError('SWAP_OFFER_UNKNOWN');
      reply(request, sendResponse, { success: true, record });
    } catch (error) {
      replyError(request, sendResponse, error);
    }
  });
}
