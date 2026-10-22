import { reactive } from 'vue';

/**
 * Delivery-fee payments this wallet already sent, by order UUID. Zione can take a while to
 * credit a payment, and on 2026-10-22 it never did: the fee stayed "pending" and a new deposit
 * address was issued, so the dashboard offered "Complete Payment" again and invited a second
 * payment. While a sent payment is remembered here the dashboard shows it instead of the pay
 * button. Only the order UUID, the transaction id and the time are stored; all are public on
 * chain or meaningless without the account.
 */
export interface SentFeePayment {
  txId: string;
  sentAt: number;
}

const STORAGE_KEY = 'cardSentFeePayments';
/** How long a sent payment is remembered, long enough for Zione support to sort out a stuck one. */
export const SENT_FEE_PAYMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const state = reactive<{ byOrder: Record<string, SentFeePayment> }>({ byOrder: {} });
let loading: Promise<void> | null = null;

function area(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
}

/** Keeps the well-formed entries younger than the TTL. */
export function pruneSentFeePayments(value: unknown, now: number): Record<string, SentFeePayment> {
  const kept: Record<string, SentFeePayment> = {};
  if (!value || typeof value !== 'object') return kept;
  for (const [orderUuid, entry] of Object.entries(value as Record<string, unknown>)) {
    const { txId, sentAt } = (entry ?? {}) as Partial<SentFeePayment>;
    if (typeof txId === 'string' && /^[0-9a-f]{64}$/i.test(txId) && typeof sentAt === 'number' && now - sentAt < SENT_FEE_PAYMENT_TTL_MS) {
      kept[orderUuid] = { txId, sentAt };
    }
  }
  return kept;
}

/** Reads the remembered payments once per page; later calls reuse the first read. */
export function loadSentFeePayments(): Promise<void> {
  loading ??= (async () => {
    const stored = await area()?.get(STORAGE_KEY);
    state.byOrder = { ...pruneSentFeePayments(stored?.[STORAGE_KEY], Date.now()), ...state.byOrder };
  })().catch(() => undefined);
  return loading;
}

/** Remembers that the delivery fee of `orderUuid` was sent in `txId`. */
export async function rememberSentFeePayment(orderUuid: string | null | undefined, txId: string | null | undefined): Promise<void> {
  if (!orderUuid || !txId) return;
  state.byOrder = { ...pruneSentFeePayments(state.byOrder, Date.now()), [orderUuid]: { txId, sentAt: Date.now() } };
  try {
    await area()?.set({ [STORAGE_KEY]: state.byOrder });
  } catch {
    // The dashboard still knows for this page; it only forgets after a reload.
  }
}

/** The payment this wallet sent for an order's delivery fee, if it is still remembered. */
export function sentFeePayment(orderUuid: string | null | undefined): SentFeePayment | null {
  return orderUuid ? state.byOrder[orderUuid] ?? null : null;
}

/** Test hook: forget everything, including the cached read. */
export function resetSentFeePaymentsForTests(): void {
  state.byOrder = {};
  loading = null;
}
