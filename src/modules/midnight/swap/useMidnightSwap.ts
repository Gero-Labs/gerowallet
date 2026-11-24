// What both swap surfaces (side panel and dashboard) share: whether the swap
// is offered for the logged wallet, the worker calls, the maker's offer list,
// the credential step, a clock for countdowns, and errors in the user's
// language. The worker decides everything that moves value; this file only
// carries intent to it and shows what it answers.

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useRawPrfPopup } from '@/shared/composables/useRawPrfPopup';
import { backgroundError } from '@/services/midnight-tx.service';
import { isMidnightSwapNetwork, midnightSwapCopyKey } from '@/chains/midnight/midnightSwapConfig';
import type { MidnightSwapLeg, MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';
import type { SwapOfferInspection, SwapTakeTerms } from '@/chrome/midnightSwapHandlers';
import type { MidnightOpenOffer } from '@/api/midnightSwapWire';

/** A worker refusal: `code` is its MidnightSwapCode or message; `text` is what the user reads. */
export class MidnightSwapCallError extends Error {
  readonly code: string;
  constructor(code: string, text: string) {
    super(text);
    this.name = 'MidnightSwapCallError';
    this.code = code;
  }
}

interface WorkerAnswer {
  data?: { success?: boolean; error?: string } & Record<string, unknown>;
  error?: string;
}

/** What the user's credential step hands the worker: a password, or the PassKey's PRF bytes as numbers. */
export type SwapCredential = { password: string } | { prfSecret: number[] };

/** The worker's refusal in the user's language. */
export function swapErrorText(code: string | undefined, t: (key: string) => string): string {
  const key = midnightSwapCopyKey(code);
  if (key) return t(key);
  // The fee's DUST sync gave up (midnightLedger9.ts): worth another try, nothing was sent.
  if (code && /DUST synchronization timed out/.test(code)) return t('midnight.swap.error.dustSlow');
  const mapped = backgroundError(code, '').message;
  return mapped && mapped !== code ? mapped : t('midnight.swap.error.generic');
}

/** Whether the swap exists for the logged wallet: a Midnight wallet on a swap network. */
export const midnightSwapAvailable = computed(() =>
  walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT && isMidnightSwapNetwork(walletStore.loggedWallet?.network));

export function useMidnightSwap() {
  const { t } = useTranslation();
  const { requestRawPrf, cancelPopups } = useRawPrfPopup();
  const network = computed(() => walletStore.loggedWallet?.network ?? null);
  const isPrfWallet = computed(() => !!walletStore.loggedWallet?.webAuthnCredentialId);

  async function call<T extends Record<string, unknown>>(type: string, data: Record<string, unknown> = {}): Promise<T> {
    const answer = await Messaging.sendToBackgroundFromOptions({ method: type, data }) as WorkerAnswer | undefined;
    const body = answer?.data;
    if (!body?.success) {
      const code = body?.error ?? answer?.error;
      throw new MidnightSwapCallError(code ?? '', swapErrorText(code, t));
    }
    return body as T;
  }

  // ── The maker's offers ──
  const offers = shallowRef<MidnightSwapOfferRecord[]>([]);
  const offersLoaded = ref(false);
  async function refreshOffers(): Promise<void> {
    if (!midnightSwapAvailable.value) return;
    try {
      offers.value = (await call<{ records: MidnightSwapOfferRecord[] }>(MessageTypes.MIDNIGHT_SWAP_LIST_OFFERS)).records;
    } catch {
      // Keep the last list: a worker restart or a lock is not "no offers".
    } finally {
      offersLoaded.value = true;
    }
  }

  // ── A clock for countdowns, and a re-read when the coins move ──
  const now = ref(Date.now());
  let ticker: ReturnType<typeof setInterval> | undefined;
  let lastRefresh = 0;
  let lastOpenRefresh = Date.now();
  onMounted(() => {
    void refreshOffers();
    void refreshOpenOffers();
    ticker = setInterval(() => {
      now.value = Date.now();
      // Statuses come from the coins; a slow re-read also catches an expiry.
      if (now.value - lastRefresh > 20_000) { lastRefresh = now.value; void refreshOffers(); }
      // Every minute once Nexus answered; sooner until then (a first read can fail while the device signs in).
      if (now.value - lastOpenRefresh > (geroListAvailable.value ? 60_000 : 15_000)) { lastOpenRefresh = now.value; void refreshOpenOffers(); }
    }, 1_000);
  });
  onBeforeUnmount(() => { if (ticker) clearInterval(ticker); cancelPopups(); });
  watch(() => [midnightStore.lastSync, midnightStore.utxos.length, network.value], () => { void refreshOffers(); });

  /** The credential for a write: the typed password, or a PassKey ceremony. */
  async function credential(password: string, current: () => boolean = () => true): Promise<SwapCredential> {
    if (isPrfWallet.value) {
      const bytes = await requestRawPrf(current);
      try {
        return { prfSecret: Array.from(bytes) };
      } finally {
        bytes.fill(0);
      }
    }
    return { password };
  }

  async function makeOffer(args: { give: MidnightSwapLeg; want: MidnightSwapLeg; ttlMinutes: number }, cred: SwapCredential) {
    const { record } = await call<{ record: MidnightSwapOfferRecord }>(MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, { ...args, ...cred });
    offers.value = [record, ...offers.value.filter(r => r.offerId !== record.offerId)];
    return record;
  }

  async function inspectOffer(offer: string): Promise<SwapOfferInspection> {
    return (await call<{ inspection: SwapOfferInspection }>(MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, { offer })).inspection;
  }

  async function takeOffer(offer: string, expect: SwapTakeTerms, cred: SwapCredential): Promise<string> {
    return (await call<{ txHash: string }>(MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER, { offer, expect, ...cred })).txHash;
  }

  async function withdrawOffer(offerId: string, cred: SwapCredential): Promise<string> {
    const { txHash } = await call<{ txHash: string }>(MessageTypes.MIDNIGHT_SWAP_WITHDRAW_OFFER, { offerId, ...cred });
    await refreshOffers();
    return txHash;
  }

  // ── Gero's open-offers list (Nexus): absent while Nexus has no swap routes here ──
  const openOffers = shallowRef<MidnightOpenOffer[]>([]);
  /** `false` until Nexus answers with a list; then the list and "List with Gero" show. */
  const geroListAvailable = ref(false);
  async function refreshOpenOffers(): Promise<void> {
    if (!midnightSwapAvailable.value || !network.value) return;
    try {
      const { getMidnightApi } = await import('@/api/midnight-api');
      const list = await getMidnightApi(network.value).listOpenSwapOffers({ limit: 50 });
      geroListAvailable.value = list !== null;
      openOffers.value = (list ?? []).filter(offer => offer.expiresAt === null || offer.expiresAt > Date.now());
    } catch {
      geroListAvailable.value = false;
      openOffers.value = [];
    }
  }

  /** An open offer's `swapoffer1…` string: from the list row, or fetched by id. */
  async function openOfferString(offer: MidnightOpenOffer): Promise<string | null> {
    if (offer.offerBech32) return offer.offerBech32;
    if (!network.value) return null;
    const { getMidnightApi } = await import('@/api/midnight-api');
    try {
      return (await getMidnightApi(network.value).getSwapOffer(offer.offerId))?.offerBech32 ?? null;
    } catch {
      return null;
    }
  }

  /** List an offer with Gero (POST swap-offers), then note it. Throws a MidnightSwapCallError. */
  async function listWithGero(record: MidnightSwapOfferRecord): Promise<void> {
    const { getMidnightApi } = await import('@/api/midnight-api');
    try {
      await getMidnightApi(record.network).listSwapOffer(record.offer);
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      throw new MidnightSwapCallError(code, swapErrorText(code, t));
    }
    const { record: updated } = await call<{ record: MidnightSwapOfferRecord }>(MessageTypes.MIDNIGHT_SWAP_MARK_LISTED, { offerId: record.offerId });
    offers.value = offers.value.map(r => (r.offerId === updated.offerId ? updated : r));
  }

  return {
    network,
    isPrfWallet,
    now,
    offers,
    offersLoaded,
    refreshOffers,
    credential,
    makeOffer,
    inspectOffer,
    takeOffer,
    withdrawOffer,
    listWithGero,
    openOffers,
    geroListAvailable,
    refreshOpenOffers,
    openOfferString,
  };
}
