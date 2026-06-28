import { ref, computed } from 'vue';
import { strikeUserApi } from '@/api/strike-v2.user';
import { hasStrikeApiKeys } from '@/api/strike-v2.client';
import type { WithdrawQuoteResponse } from '@/api/strike-v2.types';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

/**
 * Strike v2 withdraw quote – wraps the validator response and adds local
 * timing fields the UI relies on (countdown, etc.).
 */
export interface WithdrawQuote extends WithdrawQuoteResponse {
  /** Optional fields surfaced if the runtime returns them. */
  fee?: string;
  expires_at?: string;
  amount_received?: string;
  /** Local Unix-ms timestamp parsed from `expires_at`. 0 if not provided. */
  expiresAtMs: number;
  /** Local Unix-ms timestamp captured when the quote was received. */
  receivedAtMs: number;
}

export type WithdrawStatus =
  | 'idle'
  | 'quoting'
  | 'quoted'
  | 'signing'
  | 'submitting'
  | 'pending'
  | 'settled'
  | 'error';

// ── Module-level singleton state ────────────────────────────────────────────
const quote = ref<WithdrawQuote | null>(null);
const status = ref<WithdrawStatus>('idle');
const error = ref<string | null>(null);
const requestId = ref<string | null>(null);

// ── Helpers ─────────────────────────────────────────────────────────────────

/** UTF-8 string → lower-case hex (no `0x` prefix) — required by CIP-30 signData. */
function utf8ToHex(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/** Best-effort ISO 8601 parser → Unix ms; returns 0 when unparseable. */
function parseExpiry(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function getActiveStakeAddress(): string | null {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return null;
  return wallet.stakeAddress ?? wallet.baseAddress ?? null;
}

/**
 * Sign a CIP-8 / COSE_Sign1 over the given UTF-8 message using the active
 * wallet's stake key. Returns the COSE_Sign1 hex (the `signature` field of
 * the CIP-30 DataSignature) which Strike expects as `wallet_signature`.
 *
 * Routes through `MessageTypes.SIGN_DATA` → `walletBg.signData` → the
 * `signDataCip8` utility in `src/chrome/serialization.ts`. This bypasses the
 * dapp-connector protocol layer entirely while still producing the wire
 * format Strike requires.
 *
 * @param message  Plain UTF-8 message returned by the validator.
 * @param password Spending password (empty string for HW / PRF wallets — the
 *                 background path will use the appropriate auth flow).
 * @param pkBytes  Pre-decrypted root key bytes for PRF (passkey) wallets,
 *                 obtained from PassKeyAuthButton. When present these are sent
 *                 as privateKeyBytes and the password is ignored.
 */
async function signCip8(message: string, password: string, pkBytes?: Uint8Array): Promise<string> {
  const stakeAddress = getActiveStakeAddress();
  if (!stakeAddress) {
    throw new Error('No active wallet — cannot sign withdrawal message.');
  }

  const payloadHex = utf8ToHex(message);

  const res = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SIGN_DATA,
    data: {
      address: stakeAddress,
      payload: payloadHex,
      // PRF wallets pass the pre-decrypted root key bytes instead of a password.
      password: pkBytes ? '' : password,
      ...(pkBytes ? { privateKeyBytes: Array.from(pkBytes) } : {}),
      accountIndex: 0,
      isUsb: false,
    },
  }) as { data?: { signature?: string; key?: string; error?: string }; error?: string };

  if (res?.error) {
    throw new Error(typeof res.error === 'string' ? res.error : 'Signing failed');
  }
  if (res?.data?.error) {
    throw new Error(res.data.error);
  }
  if (!res?.data?.signature || !res?.data?.key) {
    throw new Error('Wallet returned no signature');
  }
  // Strike expects the Cardano signature as the CIP-30 COSE pair joined by a
  // colon: `${coseSign1Hex}:${coseKeyHex}` (per the Strike builder reference —
  // strike-builder-reference/src/api/withdraw.ts + strike-finance-skills).
  return `${res.data.signature}:${res.data.key}`;
}

// ── Public composable ───────────────────────────────────────────────────────

export function useStrikeWithdraw() {
  /** Live ADA/USD price (from priceStore). 0 if unavailable. */
  const usdPerAda = computed(() => priceStore.adaUsd?.lastPrice ?? 0);
  /** Local convenience: USD → ADA conversion rate. */
  const usdToAdaRate = computed(() => (usdPerAda.value > 0 ? 1 / usdPerAda.value : 0));
  /** Strike publishes withdrawal SLAs as “a few minutes”; default to 5 in UI. */
  const deliveryMinutes = computed(() => 5);
  const isWithdrawing = computed(() =>
    ['quoting', 'signing', 'submitting', 'pending'].includes(status.value),
  );

  /**
   * Step 1 — request a withdrawal quote.
   *
   * @param amountUsd USD amount the user wants to withdraw.
   * @param asset     Asset to receive (defaults to 'ADA' for Cardano).
   */
  async function requestQuote(amountUsd: string, asset = 'ADA'): Promise<void> {
    error.value = null;
    quote.value = null;
    requestId.value = null;
    status.value = 'quoting';

    // Authenticated endpoint — guard against an unauthenticated 401 when no
    // API-wallet key is loaded.
    if (!hasStrikeApiKeys()) {
      error.value = 'Connect to Strike first — open the Vaults tab and tap "Connect to Strike".';
      status.value = 'error';
      return;
    }

    try {
      const recipient = walletStore.loggedWallet?.baseAddress ?? '';
      if (!recipient) {
        throw new Error('No active Cardano wallet.');
      }
      const amt = parseFloat(amountUsd);
      if (!Number.isFinite(amt) || amt <= 0) {
        throw new Error('Invalid withdrawal amount.');
      }

      const raw = await strikeUserApi.getWithdrawQuote({
        usd_value: amountUsd,
        blockchain: 'cardano',
        asset,
      }) as WithdrawQuoteResponse & {
        fee?: string;
        expires_at?: string;
        amount_received?: string;
      };

      quote.value = {
        ...raw,
        fee: raw.fee,
        expires_at: raw.expires_at,
        amount_received: raw.amount_received,
        expiresAtMs: parseExpiry(raw.expires_at),
        receivedAtMs: Date.now(),
      };
      status.value = 'quoted';
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      status.value = 'error';
    }
  }

  /**
   * Step 2 — sign the quote message and submit. Drives status through
   * `signing → submitting → pending → settled`.
   */
  async function signAndSubmit(password: string, pkBytes?: Uint8Array): Promise<boolean> {
    if (!quote.value) {
      error.value = 'No active withdrawal quote.';
      status.value = 'error';
      return false;
    }
    if (quote.value.expiresAtMs && Date.now() > quote.value.expiresAtMs) {
      error.value = 'Quote expired — please request a new one.';
      status.value = 'error';
      return false;
    }

    try {
      status.value = 'signing';
      const walletSignature = await signCip8(quote.value.message_to_sign, password, pkBytes);

      status.value = 'submitting';
      const submitRes = await strikeUserApi.executeWithdraw(
        quote.value.withdraw_id,
        walletSignature,
      );
      requestId.value = submitRes.request_id ?? quote.value.withdraw_id;

      // Submitting the signed quote is the terminal step. Strike accepts the
      // withdrawal and settles it on-chain to the account's registered address;
      // the ADA then shows up via the wallet's own balance sync. Strike has NO
      // status-poll endpoint — the old pollSettlement hit /v2/transaction/status
      // (a route that doesn't exist), which 401'd and made the auth interceptor
      // wipe the keys + show a "reconnect" prompt on a successful withdrawal.
      // The 'settled' copy ("Funds are on their way to your wallet") is honest
      // for this accepted-and-settling state.
      status.value = 'settled';
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      status.value = 'error';
      return false;
    }
  }

  function reset(): void {
    quote.value = null;
    status.value = 'idle';
    error.value = null;
    requestId.value = null;
  }

  // Backwards-compatible aliases used by existing call-sites (e.g. WithdrawSheet).
  const withdrawStatus = status;
  const withdrawError = error;
  const resetWithdraw = reset;

  return {
    // State
    quote,
    status,
    error,
    requestId,
    // Aliases
    withdrawStatus,
    withdrawError,
    resetWithdraw,
    // Computed
    isWithdrawing,
    usdPerAda,
    usdToAdaRate,
    deliveryMinutes,
    // Methods
    requestQuote,
    signAndSubmit,
    reset,
  };
}
