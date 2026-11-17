import { computed, type ComputedRef, type Ref } from 'vue';
import { currencyTickerNow } from '@/modules/market/composables/useNativeCurrency';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import i18n, { getLocaleCode } from '@/plugins/i18n';
import { debugLog } from '@/utils/debug';
import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import type { MarketAction, RoyaltyNotes } from '@/chrome/nftMarket/marketPrepare';
import type { CancelSummary, ListSummary, RepriceSummary } from '@/chrome/nftMarket/verifyListing';
import type { BuySummary } from '@/chrome/nftMarket/verifyBuy';
import type { MigrateSummary } from '@/chrome/nftMarket/verifyMigrate';
import {
  PREPARED_TX_EXPIRED,
  PREPARED_TX_SIGN_FAILED,
  PREPARED_TX_SUBMIT_FAILED,
  PREPARED_TX_WRONG_PASSWORD,
  usePreparedTxFlow,
  type PreparedTxFailure,
  type PreparedTxFlowOptions,
} from '@/shared/composables/usePreparedTxFlow';
import { formatPercentOfFraction, formatTokenQuantity } from '@/shared/utils/format';
import { NFT_MARKET_EXPIRED_KEY } from '@/shared/utils/nftMarketSignRefusal';
import { walletStore } from '@/stores/walletStore';
import { MIN_LIST_PRICE, MIN_SELLER_SHARE } from '@/utils/nftMarketDeployments';

/**
 * The Gero NFT market's actions (list, reprice, cancel, buy, migrate), page side. The dialogs of
 * the options page call this and nothing lower.
 *
 * The page names only the thing: an NFT and a price, or a listing ref. The worker
 * (NFT_MARKET_PREPARE_<ACTION>, marketPrepare.ts) chooses every address, key and input, has
 * Nexus build, verifies the CBOR against the request and answers `{ success, result: { txCbor,
 * txId, summary } }` or `{ success: false, errorCode, ...details }`. The request is built here
 * field by field from the action's own payload, so nothing else a caller holds (an owner, a
 * seller address, inputs) can ride along. The signing is the shared usePreparedTxFlow:
 *
 *   PREPARE → VERIFY_SPENDING_PASSWORD (password wallets) → SIGN_TX → SUBMIT_TX {txCbor, witnessHex}
 *
 * with the CBOR signed and submitted exactly as the worker returned it, never re-encoded, and
 * collateral Nexus lent (`summary.sponsoredCollateralRef`) co-signed by the pool. Which wallet
 * types may reach a device is the worker's call (`NFT_MARKET_HARDWARE_WALLET_TYPES`), not this
 * file's.
 *
 * WHAT A DIALOG SHOWS. Never a string from a reply. Every failure is a code (`failure.code`)
 * that this file turns into a `failureKind` (what the dialog does next) and a `failureMessage`
 * (`{ key, params? }` for `$t()`). The worker's own text and anything Nexus said are never copied
 * out of the reply, and the rule a verifier refused on is only logged (VERIFY_FAILED reads the
 * same whatever refused).
 *
 *   changed         the listing or the NFT is not as it was (sold, delisted, repriced, moved). This
 *                   attempt sent nothing, but the change may be the user's OWN earlier transaction
 *                   having gone through, so the copy says it may have and points to Activity.
 *                   Refresh what is shown, then the user may start again.
 *   maybeSent       signed, and the submit was not confirmed: the transaction may be on chain.
 *                   Send the user to their activity; never offer a retry.
 *   wrongPassword   the spending password was wrong: stay on the review and ask again.
 *   confirmRoyalty  the list, reprice or move needs the seller's confirmation of royalties above the
 *                   usual limit (a reprice's are computed again at its new price, as a list's):
 *                   `royaltyConfirmation` has the amounts; prepare again with
 *                   `confirmRoyaltyAboveCap: true` once they agree.
 *   refused         the same request fails the same way (a rule, a price, a wallet that is not
 *                   allowed): say why, offer no retry.
 *   retry           building or signing again can work: offer "Try again" (it prepares again).
 *
 * THE SALE ALERT. A list, reprice or move that went through registers its new listing with
 * gero-sync (NOTIFY_WATCH_LISTINGS), so the wallet is told when it sells. Once per submitted
 * transaction, with the listing output the worker's verified summary names (never an assumed 0),
 * fire-and-forget: the done screen never waits for it, and no answer (not registered for
 * notifications, a limit, a refusal, a worker that did not reply) is shown to anyone. The page sends
 * the wallet id and the ref only; the worker uses the logged wallet, a listing it verified itself
 * and that listing's own datum owner (listingWatch.ts), so nothing here is trusted by it.
 */

export type NftMarketFailureKind = 'changed' | 'maybeSent' | 'wrongPassword' | 'confirmRoyalty' | 'refused' | 'retry';

/** What a dialog hands `$t()`. */
export interface NftMarketMessage {
  key: string;
  params?: Record<string, string>;
}

export interface NftMarketFailure extends PreparedTxFailure {
  /** ROYALTY_CONFIRMATION_REQUIRED: the royalties that would be paid, in lovelace (decimal text). */
  effectiveRoyaltyLovelace?: string;
  /** ROYALTY_CONFIRMATION_REQUIRED: that sum over the price, as a fraction with six digits ("0.150000"). */
  effectiveRoyaltyRate?: string;
  /** ROYALTY_CONFIRMATION_REQUIRED: the collection's own total rate, as a fraction with six digits. */
  royaltyRate?: string;
}

/**
 * The failure as `usePreparedTxFlow` reads it off the worker's reply: the public fields plus the
 * worker's own `error` note. The note is read only to be logged (the rule of a VERIFY_FAILED) and
 * is dropped before the page sees it: it is not copy, and it is not part of `NftMarketFailure`.
 */
interface NftMarketFailureReply extends NftMarketFailure {
  error?: string;
}

/** What the seller is asked to confirm when the royalties pass the usual limit. */
export interface RoyaltyConfirmation {
  effectiveRoyaltyLovelace: string;
  effectiveRoyaltyRate: string;
  royaltyRate?: string;
  /** The sum in ADA, as it reads on screen ("3.75"). */
  ada: string;
  /** The sum as a percent of the price in the active language, at most two decimals ("15", "12.81", "12,81" in German). */
  percent: string;
}

/** What each action takes. Anything beyond these fields is not sent. */
export interface NftMarketPayloads {
  list: { unit: string; priceLovelace: bigint | string; confirmRoyaltyAboveCap?: boolean };
  reprice: { ref: string; priceLovelace: bigint | string; confirmRoyaltyAboveCap?: boolean };
  cancel: { ref: string };
  buy: { ref: string };
  migrate: { legacyRef: string; priceLovelace: bigint | string; confirmRoyaltyAboveCap?: boolean };
}

/** What the review screen shows for each action, as the worker verified it. */
export interface NftMarketSummaries {
  list: ListSummary & RoyaltyNotes;
  reprice: RepriceSummary;
  cancel: CancelSummary;
  buy: BuySummary;
  migrate: MigrateSummary & RoyaltyNotes;
}

export type NftMarketSummary<A extends MarketAction = MarketAction> = NftMarketSummaries[A] & { sponsoredCollateralRef?: string };

export type NftMarketFlowOptions = Pick<PreparedTxFlowOptions, 'getIsBT'>;

/**
 * The page's own failure code for a submit the network refused because an input was already
 * spent: the listing was bought, delisted or repriced between the review and the signature, or
 * a wallet UTxO moved. Nothing is on its way.
 */
export const NFT_MARKET_INPUT_SPENT = 'INPUT_SPENT';

/**
 * Whether a failed submit says an input of the transaction is gone: the ledger's
 * `BadInputsUTxO`, or Ogmios's unknown-output-references rejection (code 3117, spent or never
 * existed). Matched on those names only, never on a number, so an unrelated amount in another
 * refusal cannot read as a spent input.
 */
export function isInputAlreadySpentError(message: string): boolean {
  return /BadInputsUTxO|unknownOutputReferences|unknown UTxO references?|already (?:been )?spent/i.test(message);
}

/** Lovelace as ADA, the way amounts read in the wallet: up to six decimals, no trailing zeros. */
const adaText = (lovelace: bigint): string => formatTokenQuantity(Number(lovelace) / 1_000_000, 6);

const msg = (key: string, params?: Record<string, string>): NftMarketMessage => (params ? { key, params } : { key });

/**
 * What a failure code means for the dialog: the state it is in and the copy to show. Pure, and
 * the one place the worker's and Nexus's codes are read. A code nobody here knows (one Nexus adds
 * later) is the general retry, never raw text.
 */
export function describeNftMarketFailure(
  action: MarketAction,
  failure: Pick<NftMarketFailure, 'code'>,
): { kind: NftMarketFailureKind; message: NftMarketMessage } {
  const is = (kind: NftMarketFailureKind, key: string, params?: Record<string, string>) => ({ kind, message: msg(key, params) });
  switch (failure.code) {
    // The listing or the NFT is not as it was.
    case 'LISTING_NOT_FOUND':
      return is('changed', 'nftMarket.error.listingChanged');
    case NFT_MARKET_INPUT_SPENT:
      // A buyer lost a race; a seller's own reprice, cancel or move found the listing gone. A new
      // listing only ever runs into the wallet's own view being a step behind.
      if (action === 'buy') return is('changed', 'nftMarket.error.soldOrDelisted');
      if (action === 'list') return is('retry', 'nftMarket.error.feeInputSpent');
      return is('changed', 'nftMarket.error.listingChanged');
    case 'NFT_NOT_FOUND':
      return is('changed', 'nftMarket.error.nftNotFound');

    // The wallet's checks.
    case 'VERIFY_FAILED':
      return is('refused', 'nftMarket.error.verifyFailed');
    case 'ROYALTY_CONFIRMATION_REQUIRED':
      return is('confirmRoyalty', 'nftMarket.error.royaltyConfirmation');
    case 'ROYALTIES_MALFORMED':
      return is('refused', 'nftMarket.error.royaltiesMalformed');
    case 'ROYALTIES_UNREADABLE':
      return is('retry', 'nftMarket.error.royaltiesUnreadable');
    case 'TOO_MANY_ROYALTIES':
      return is('refused', 'nftMarket.error.tooManyRoyalties');
    case 'PRICE_TOO_LOW':
      return is('refused', 'nftMarket.error.priceTooLow', { ticker: currencyTickerNow(), min: adaText(MIN_LIST_PRICE) });
    case 'SELLER_SHARE_TOO_LOW':
      return is('refused', 'nftMarket.error.sellerShareTooLow', { ticker: currencyTickerNow(), min: adaText(MIN_SELLER_SHARE) });

    // The listing cannot be used here.
    case 'PRIVATE_LISTING':
      return is('refused', 'nftMarket.error.privateListing');
    case 'OWN_LISTING':
      return is('refused', 'nftMarket.error.ownListing');
    case 'NOT_OWNED':
      return is('refused', 'nftMarket.error.notOwned');
    case 'OFFER_NOT_MOVABLE':
      return is('refused', 'nftMarket.error.offerNotMovable');
    case 'NOT_SINGLE_NFT':
      return is('refused', 'nftMarket.error.notSingleNft');
    case 'NOT_GERO_LISTING':
    case 'DATUM_UNREADABLE':
      return is('refused', 'nftMarket.error.notListing');
    case 'LISTING_UNREADABLE':
      return is('retry', 'nftMarket.error.listingUnreadable');

    // Where the wallet is.
    case 'NETWORK_UNSUPPORTED':
      return is('refused', 'nftMarket.error.networkUnsupported');
    case 'WALLET_UNSUPPORTED':
      return is('refused', 'nftMarket.error.walletUnsupported');
    case 'WALLET_CHANGED':
      return is('retry', 'nftMarket.error.walletChanged');
    case 'INSUFFICIENT_ADA':
      return is('refused', 'nftMarket.error.insufficientAda');
    case 'NO_COLLATERAL':
      // The shared collateral pool may only be empty for now.
      return is('retry', 'nftMarket.error.noCollateral');
    case 'FEE_INPUT_SPENT':
      return is('retry', 'nftMarket.error.feeInputSpent');

    // The builder.
    case 'EVALUATION_FAILED':
      // The contract refused the listing as it now stands (a price or datum that moved): refresh first.
      return is('changed', 'nftMarket.error.rejected');
    case 'INVALID_REQUEST':
    case 'TOO_MANY_LISTINGS':
      // Nexus's "more listings than one transaction takes": a market request names one listing, so
      // this can only mean the request is wrong, and asking again cannot change it.
      return is('refused', 'nftMarket.error.invalidRequest');

    // The page's own codes: the signature and the submit.
    case PREPARED_TX_WRONG_PASSWORD:
      return is('wrongPassword', 'errors.wrongPassword');
    case PREPARED_TX_EXPIRED:
      return is('retry', NFT_MARKET_EXPIRED_KEY);
    case PREPARED_TX_SIGN_FAILED:
      return is('retry', 'nftMarket.error.signFailed');
    case PREPARED_TX_SUBMIT_FAILED:
      return is('maybeSent', 'nftMarket.error.maybeSent');

    // BUILD_FAILED, and anything not named above.
    default:
      return is('retry', 'nftMarket.error.failed');
  }
}

/** The amounts of a royalty confirmation from a failure, or null when it is not one or has no usable amounts. */
function royaltyConfirmationOf(failure: NftMarketFailure | null, localeCode: string): RoyaltyConfirmation | null {
  if (failure?.code !== 'ROYALTY_CONFIRMATION_REQUIRED') return null;
  const { effectiveRoyaltyLovelace, effectiveRoyaltyRate, royaltyRate } = failure;
  if (!effectiveRoyaltyLovelace || !/^\d+$/.test(effectiveRoyaltyLovelace)) return null;
  const rate = Number(effectiveRoyaltyRate);
  if (!effectiveRoyaltyRate || !Number.isFinite(rate)) return null;
  return {
    effectiveRoyaltyLovelace,
    effectiveRoyaltyRate,
    ...(royaltyRate ? { royaltyRate } : {}),
    ada: adaText(BigInt(effectiveRoyaltyLovelace)),
    percent: formatPercentOfFraction(rate, localeCode),
  };
}

const PREPARE_MESSAGE: Record<MarketAction, MessageTypes> = {
  list: MessageTypes.NFT_MARKET_PREPARE_LIST,
  reprice: MessageTypes.NFT_MARKET_PREPARE_REPRICE,
  cancel: MessageTypes.NFT_MARKET_PREPARE_CANCEL,
  buy: MessageTypes.NFT_MARKET_PREPARE_BUY,
  migrate: MessageTypes.NFT_MARKET_PREPARE_MIGRATE,
};

/** A price as the decimal text the worker takes. */
const lovelaceText = (price: bigint | string): string => (typeof price === 'bigint' ? price.toString() : price);

/**
 * The request of one action, built from that action's fields only. The royalty confirmation is
 * sent only when it is exactly `true`.
 */
function requestFor(action: MarketAction, payload: NftMarketPayloads[MarketAction]): Record<string, unknown> {
  switch (action) {
    case 'list': {
      const { unit, priceLovelace, confirmRoyaltyAboveCap } = payload as NftMarketPayloads['list'];
      return { unit, priceLovelace: lovelaceText(priceLovelace), ...(confirmRoyaltyAboveCap === true ? { confirmRoyaltyAboveCap: true } : {}) };
    }
    case 'reprice': {
      const { ref, priceLovelace, confirmRoyaltyAboveCap } = payload as NftMarketPayloads['reprice'];
      return { ref, priceLovelace: lovelaceText(priceLovelace), ...(confirmRoyaltyAboveCap === true ? { confirmRoyaltyAboveCap: true } : {}) };
    }
    case 'cancel':
    case 'buy': {
      const { ref } = payload as NftMarketPayloads['cancel' | 'buy'];
      return { ref };
    }
    case 'migrate': {
      const { legacyRef, priceLovelace, confirmRoyaltyAboveCap } = payload as NftMarketPayloads['migrate'];
      return { legacyRef, priceLovelace: lovelaceText(priceLovelace), ...(confirmRoyaltyAboveCap === true ? { confirmRoyaltyAboveCap: true } : {}) };
    }
  }
}

/** The actions that create a listing of the wallet's, which a sale alert can watch. */
const SALE_ALERT_ACTIONS: ReadonlySet<MarketAction> = new Set<MarketAction>(['list', 'reprice', 'migrate']);

/** A transaction id and the index of the listing output, from a verified summary: both well-formed, or null. */
function listingRefOf(summary: unknown): string | null {
  const { txId, listingOutputIndex } = (summary ?? {}) as { txId?: unknown; listingOutputIndex?: unknown };
  if (typeof txId !== 'string' || !/^[0-9a-f]{64}$/.test(txId)) return null;
  if (typeof listingOutputIndex !== 'number' || !Number.isSafeInteger(listingOutputIndex) || listingOutputIndex < 0) return null;
  return `${txId}#${listingOutputIndex}`;
}

export function useNftMarketFlow<A extends MarketAction>(action: A, options: NftMarketFlowOptions = {}) {
  const flow = usePreparedTxFlow<NftMarketSummary<A>, NftMarketFailureReply>({
    getIsBT: options.getIsBT,
    refusalMessage: NFT_MARKET_SIGN_REFUSAL_MESSAGE,
    submitRefusalCode: (text) => (isInputAlreadySpentError(text) ? NFT_MARKET_INPUT_SPENT : undefined),
    ownCodes: [NFT_MARKET_INPUT_SPENT],
    failureFields: ['error', 'effectiveRoyaltyLovelace', 'effectiveRoyaltyRate', 'royaltyRate'],
  });

  // What a dialog reads is the public failure: the reply's own note is dropped in `prepare`.
  const failure = flow.failure as Ref<NftMarketFailure | null>;
  const described = computed(() => (failure.value ? describeNftMarketFailure(action, failure.value) : null));
  const failureKind: ComputedRef<NftMarketFailureKind | null> = computed(() => described.value?.kind ?? null);
  const failureMessage: ComputedRef<NftMarketMessage | null> = computed(() => described.value?.message ?? null);
  const royaltyConfirmation: ComputedRef<RoyaltyConfirmation | null> = computed(() => royaltyConfirmationOf(failure.value, getLocaleCode(i18n.locale)));

  /**
   * Have the worker build and verify this action. True when a summary is ready to review. On a
   * failure, `failureKind` and `failureMessage` say what to do and show; the worker's own note
   * is logged (the rule of a VERIFY_FAILED) and dropped.
   */
  async function prepare(payload: NftMarketPayloads[A]): Promise<boolean> {
    const prepared = await flow.prepare(PREPARE_MESSAGE[action], requestFor(action, payload));
    const reply = flow.failure.value;
    if (!prepared && reply && reply.error !== undefined) {
      if (reply.code === 'VERIFY_FAILED') debugLog('NFT market verify refused:', action, reply.error);
      const { error: _note, ...rest } = reply;
      flow.failure.value = rest;
    }
    return prepared;
  }

  /** Transactions whose listing was already sent for the alert: once per submit, however often a result is read. */
  const alerted = new Set<string>();

  /** Tell the worker to have gero-sync watch the listing. Never awaited, never throws, never shown. */
  function registerSaleAlert(ref: string, walletId: number | undefined): void {
    const txId = ref.split('#')[0];
    if (alerted.has(txId)) return;
    alerted.add(txId);
    void Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.NOTIFY_WATCH_LISTINGS,
      data: { ...(walletId !== undefined ? { walletId } : {}), listingRefs: [ref] },
    }).then(
      (reply) => {
        const result = (reply as { data?: { result?: { result?: string } } } | undefined)?.data?.result?.result;
        if (result !== 'ok') debugLog('NFT market: sale alert not registered:', result ?? 'no answer');
      },
      (e: unknown) => debugLog('NFT market: sale alert not registered:', e instanceof Error ? e.name : 'error'),
    );
  }

  /** Sign and submit, then (for a list, reprice or move that went through) register the sale alert. */
  async function signAndSubmit(credentials?: Parameters<typeof flow.signAndSubmit>[0]): Promise<boolean> {
    // Read before signing: a reset or a wallet switch afterwards must not change what was submitted.
    const ref = SALE_ALERT_ACTIONS.has(action) ? listingRefOf(flow.prepared.value?.summary) : null;
    const walletId = walletStore.loggedWallet?.id;
    const submitted = await flow.signAndSubmit(credentials);
    if (submitted && ref) registerSaleAlert(ref, typeof walletId === 'number' ? walletId : undefined);
    return submitted;
  }

  return { ...flow, failure, prepare, signAndSubmit, failureKind, failureMessage, royaltyConfirmation };
}
