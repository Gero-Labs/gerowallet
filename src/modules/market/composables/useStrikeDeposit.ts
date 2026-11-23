import { ref, computed, watch, onUnmounted } from 'vue';
import { passwordCheckFailure } from '@/shared/utils/passwordCheck';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { strikeUserApi } from '@/api/strike-v2.user';
import { hasStrikeApiKeys } from '@/api/strike-v2.client';
import { extractStrikeError } from '@/api/strike-v2.error';
import type { DepositQuoteResponse } from '@/api/strike-v2.types';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { Messaging, type BackgroundResponse, type VerifyPasswordResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { debugLog } from '@/utils/debug';
import i18n from '@/plugins/i18n';
import { utxoToCip30Hex } from '@/modules/swap/composables/utxoToCip30Hex';
import { isStrikeQuoteExpired, verifyStrikeDepositTx } from '@/modules/market/utils/strikeDepositGuard';
import { derivedOwnAddresses, derivedOwnKeyHashes } from '@/shared/utils/ownAddresses';
import { backendSource, historySource, proveOwnInputs } from '@/shared/utils/provenInputs';

/**
 * Lifecycle states for the deposit flow.
 *
 * idle       → no active deposit
 * quoting    → waiting for the validator to return a deposit quote
 * quoted     → quote returned, awaiting user confirmation
 * building   → constructing the Cardano transaction to the deposit address
 * signing    → awaiting spending-password / hardware-wallet / PassKey signature
 * submitting → broadcasting the signed transaction to the blockchain
 * confirming → tx submitted, calling Strike's confirm endpoint
 * credited   → deposit confirmed and Strike balance updated
 * confirmed  → alias of `credited` retained for legacy UIs
 * error      → unrecoverable error; see `error` ref for the message
 */
export type DepositStatus =
  | 'idle'
  | 'quoting'
  | 'quoted'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'credited'
  | 'confirmed'
  | 'error';

// ── Module-level singleton state ──────────────────────────────────────────
// Only one deposit can be in flight at a time, so refs are shared across all
// callers of `useStrikeDeposit()` within the same context.
const quote = ref<DepositQuoteResponse | null>(null);
const status = ref<DepositStatus>('idle');
const txHash = ref<string | null>(null);
const error = ref<string | null>(null);
let quoteRequestVersion = 0;

/**
 * What became of a deposit once its transaction was handed to the network.
 *
 * From the SUBMIT_TX send onwards the ADA may have moved, so the result no longer
 * belongs to the review on screen: `reset()`, closing the sheet, a new quote and a
 * wallet switch all leave it alone. It is kept under the wallet it was sent from
 * (`strikeWalletKey()`), shown only while that wallet is the logged one, and
 * dropped by `acknowledgeSubmission()` once it is final and has been seen.
 */
export interface StrikeDepositSubmission {
  walletKey: string;
  requestId: string;
  /** The quoted deposit, in lovelace. */
  lovelace: string;
  status: 'submitting' | 'confirming' | 'confirmed' | 'error';
  txHash: string | null;
  error: string | null;
}
const submissions = ref<Record<string, StrikeDepositSubmission>>({});

/** Identifies the logged wallet account: one record per account, and its base address. */
export function strikeWalletKey(): string {
  const wallet = walletStore.loggedWallet;
  return wallet ? `${wallet.id ?? ''}|${wallet.baseAddress ?? ''}` : '';
}

function isPendingSubmission(submission: StrikeDepositSubmission | null | undefined): boolean {
  return submission?.status === 'submitting' || submission?.status === 'confirming';
}
const quoteCountdown = ref<number>(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;


function clearCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function startCountdown(expirationAt: number): void {
  clearCountdown();
  // Strike returns expiration_at as Unix seconds (most v2 endpoints) — convert
  // gracefully if it ever comes through as ms by detecting the magnitude.
  const expiresMs = expirationAt > 1e12 ? expirationAt : expirationAt * 1000;
  const tick = () => {
    const remaining = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));
    quoteCountdown.value = remaining;
    if (remaining <= 0) clearCountdown();
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/**
 * Composable for the Strike v2 on-chain deposit flow.
 *
 * Flow (Strike's deposit API is exactly these 3 steps — there is no
 * status-poll endpoint):
 *   1. `requestQuote(amountAda)` → `POST /v2/deposit/quote` returns
 *      `{ request_id, quote, deposit_address, confirmations_required }`.
 *   2. `buildAndSign(password)` asks Strike to BUILD the deposit tx
 *      (`POST /v2/deposit/build-tx`), signs it (password / Ledger / Trezor /
 *      Keystone / PassKey), submits it on-chain, then calls `POST /v2/deposit`
 *      with `{ request_id, tx_hash }` to confirm.
 *   3. Strike's backend monitors the chain and credits the balance after the
 *      required confirmations. The wallet's job ends at step 2's confirm.
 */
export function useStrikeDeposit() {
  // ── ADA balance & rate (used by the UI for max + USD preview) ────────────
  const adaToUsdRate = computed<number>(() => {
    const last = priceStore.adaUsd?.lastPrice;
    return last ? Number(last) : 0;
  });

  /** Approximate static network fee shown in the preview row. */
  const networkFee = computed<string>(() => '0.20');

  // Derived deposit-address & required-amount helpers (null-safe for UI).
  const depositAddress = computed<string>(() => quote.value?.deposit_address ?? '');
  const requiredAmountLovelace = computed<string>(
    () => quote.value?.quote.asset_amount ?? '0',
  );

  /** True now that the Strike v2 deposit endpoints are wired in. */
  const isAvailable = ref<boolean>(true);

  /** True while any phase between `quoting` and `confirming` is active. */
  const isDepositing = computed<boolean>(() =>
    ['quoting', 'building', 'signing', 'submitting', 'confirming'].includes(
      status.value,
    ),
  );

  // Backwards-compat aliases for existing UIs that imported these names from
  // the original stub. Keeping them avoids a wave of consumer changes.
  const depositStatus = status;
  const depositError = error;

  /** The submitted deposit of the logged wallet, if it has one that was not acknowledged. */
  const submission = computed<StrikeDepositSubmission | null>(
    () => submissions.value[strikeWalletKey()] ?? null,
  );

  /** Drop the logged wallet's result once it is final. A pending one stays. */
  function acknowledgeSubmission(): void {
    const key = strikeWalletKey();
    const current = submissions.value[key];
    if (!current || isPendingSubmission(current)) return;
    const rest = { ...submissions.value };
    delete rest[key];
    submissions.value = rest;
  }

  /**
   * Step 1 — request a deposit quote from Strike.
   *
   * @param amountAda - amount the user wants to deposit, in ADA (whole units).
   */
  async function requestQuote(amountAda: number | string): Promise<void> {
    const version = ++quoteRequestVersion;
    clearCountdown();
    quoteCountdown.value = 0;
    quote.value = null;
    error.value = null;
    txHash.value = null;
    status.value = 'quoting';

    // Authenticated endpoint — without a loaded API-wallet key this would be sent
    // unauthenticated and 401. Surface a clear prompt instead of a silent failure.
    if (!hasStrikeApiKeys()) {
      error.value = 'Connect to Strike first. Open the Vaults tab and tap "Connect to Strike".';
      status.value = 'error';
      return;
    }

    const numeric = typeof amountAda === 'string' ? parseFloat(amountAda) : amountAda;
    if (!numeric || isNaN(numeric) || numeric <= 0) {
      error.value = 'Invalid deposit amount.';
      status.value = 'error';
      return;
    }

    const lovelaceStr = String(Math.floor(numeric * 1_000_000));

    try {
      const response = await strikeUserApi.getDepositQuote({
        blockchain: 'cardano',
        asset_symbol: 'ADA',
        asset_amount: lovelaceStr,
      });
      if (version !== quoteRequestVersion) return;

      // Defensive shape check — bail out if the API drifts from the typed
      // contract instead of crashing later in the build step.
      if (!response?.request_id || !response.deposit_address || !response.quote?.asset_amount) {
        debugLog('[strike-deposit] quote response missing required fields:', response);
        throw new Error('Strike quote response missing deposit_address / asset_amount.');
      }

      quote.value = response;
      status.value = 'quoted';
      if (response.quote.expiration_at) {
        startCountdown(Number(response.quote.expiration_at));
      }
    } catch (e) {
      if (version !== quoteRequestVersion) return;
      // Surface Strike's real rejection reason (e.g. a minimum-deposit message)
      // instead of the opaque "Request failed with status code 400". Log the raw
      // body too so the exact server text (and any minimum threshold) is visible.
      const anyErr = e as { response?: { status?: number; data?: unknown } };
      debugLog(
        '[strike-deposit] quote rejected:',
        anyErr?.response?.status,
        anyErr?.response?.data,
      );
      error.value = extractStrikeError(
        e,
        'Strike could not quote this deposit. There may be a minimum, so try a larger amount.',
      );
      status.value = 'error';
    }
  }

  /**
   * Steps 2–4 — ask Strike to build the deposit tx, sign it with the wallet,
   * submit it on-chain, then confirm with Strike.
   *
   * Returns `true` once the tx is submitted on-chain and Strike's confirm
   * endpoint has been called (the snackbar surfaces the txid). Strike credits
   * the balance after the required on-chain confirmations — there is no status
   * to poll. Returns `false` on unrecoverable error.
   *
   * @param password - The wallet's spending password. Pass an empty string
   *   for hardware wallets (currently unsupported here — see comment below).
   * @param vaultId - Unsupported: reject vault funding rather than silently
   *   crediting the user's general trading account.
   */
  async function buildAndSign(
    password: string,
    vaultId?: string,
    // Pre-decrypted root key bytes for PRF (passkey) wallets, obtained from
    // PassKeyAuthButton. When present we skip password verification and pass
    // these as privateKeyBytes to SIGN_TX (mirrors useTransactionSigning).
    pkBytes?: Uint8Array,
  ): Promise<boolean> {
    if (isDepositing.value || status.value === 'confirmed') return false;
    // A deposit of this wallet is still on its way: its outcome comes first.
    if (isPendingSubmission(submissions.value[strikeWalletKey()])) return false;
    if (vaultId !== undefined) {
      error.value = i18n.t('vaults.transfersUnavailable');
      status.value = 'error';
      return false;
    }
    const confirmedQuote = quote.value;
    if (!confirmedQuote) {
      error.value = 'No active deposit quote. Call requestQuote() first.';
      status.value = 'error';
      return false;
    }

    const wallet = walletStore.loggedWallet;
    const utxos = walletStore.utxos as Cardano.Utxo[];
    const keys = walletStore.keys;
    if (!wallet || !keys?.payment?.[0]?.address) {
      error.value = "No active wallet. Can't build the deposit transaction.";
      status.value = 'error';
      return false;
    }

    // FUND SAFETY: a deposit is only useful if we can confirm it with Strike
    // afterwards. If the API keys aren't loaded in this context (e.g. a prior 401
    // cleared them, the session reloaded, or connect happened in another context)
    // the confirm + status calls will 401 and the ADA strands at the deposit
    // address. Re-check auth HERE — before any funds move on-chain — and abort
    // cleanly instead of sending ADA Strike can't credit.
    if (!hasStrikeApiKeys()) {
      error.value = 'Strike session is not unlocked. Reconnect to Strike before depositing (no funds were moved).';
      status.value = 'error';
      return false;
    }

    const current = () => quote.value === confirmedQuote;
    // The result belongs to the wallet whose UTxOs fund the deposit, whatever is logged later.
    const submittedFrom = strikeWalletKey();
    let submitted: StrikeDepositSubmission | null = null;
    const record = (patch: Partial<StrikeDepositSubmission>): void => {
      const before: StrikeDepositSubmission = submitted ?? {
        walletKey: submittedFrom,
        requestId: confirmedQuote.request_id,
        lovelace: confirmedQuote.quote.asset_amount,
        status: 'submitting',
        txHash: null,
        error: null,
      };
      submitted = { ...before, ...patch };
      submissions.value = { ...submissions.value, [submittedFrom]: submitted };
    };
    const wasSubmitted = () => submitted !== null;
    if (isStrikeQuoteExpired(confirmedQuote.quote.expiration_at)) {
      error.value = String(i18n.t('perpetuals.deposit.quoteExpired'));
      status.value = 'error';
      return false;
    }

    try {
      // ── 1. Ask STRIKE to build the deposit tx (POST /v2/deposit/build-tx). ──
      // Strike constructs the real vault deposit — correct script/datum + the
      // builder fee — and returns an unsigned CBOR. We must NOT build our own
      // transfer to the deposit address: a plain ADA send to the vault script is
      // NOT a creditable Strike deposit (that's why a self-built deposit didn't
      // credit). The wallet signs + submits what Strike builds only once it
      // fits the confirmed quote (checked below, before signing). For ADA it pays
      // an exchanger address Strike creates during build-tx, not deposit_address.
      status.value = 'building';
      const cip30Utxos = utxos.map(utxoToCip30Hex);
      const buildResp = await strikeUserApi.buildDepositTx({
        request_id: confirmedQuote.request_id,
        user_address: wallet.baseAddress,
        utxos: cip30Utxos,
      });
      if (!current()) return false;
      if (!buildResp?.unsigned_tx) {
        throw new Error('Strike did not return an unsigned deposit transaction.');
      }

      const transaction = Serialization.Transaction.fromCbor(HexBlob(buildResp.unsigned_tx));
      const txCore = transaction.toCore();
      const txCbor = serializeCardanoJsSdkTx(txCore);

      // Strike built this transaction from every UTxO the wallet holds: sign it
      // only if what leaves the wallet fits the deposit the user confirmed (see
      // strikeDepositGuard.ts). The bytes checked are the bytes signed and submitted.
      const requireUnexpired = () => {
        if (isStrikeQuoteExpired(confirmedQuote.quote.expiration_at) || isStrikeQuoteExpired(buildResp.expires_at)) {
          throw new Error(String(i18n.t('perpetuals.deposit.quoteExpired')));
        }
      };
      requireUnexpired();
      const signedTx = Serialization.Transaction.fromCbor(HexBlob(txCbor)).toCore();
      // Derived addresses only: the UTxO list comes from gero-sync (ownAddresses.ts),
      // and so do its values, so each input is valued from its creating transaction.
      const ownAddresses = derivedOwnAddresses(keys, wallet.baseAddress);
      const inputs = await proveOwnInputs(signedTx, {
        ownAddresses,
        claimed: utxos,
        sources: [historySource(walletStore.transactions as unknown[]), backendSource(wallet.network)],
      });
      if (!current()) return false;
      const violations = inputs.violation
        ? [inputs.violation]
        : verifyStrikeDepositTx(signedTx, {
          assetSymbol: confirmedQuote.quote.asset_symbol,
          lovelace: confirmedQuote.quote.asset_amount,
          ownAddresses,
          ownUtxos: inputs.ownUtxos,
          ownKeyHashes: derivedOwnKeyHashes(keys),
        });
      if (violations.length > 0) {
        debugLog('[strike-deposit] refused the built transaction:', violations);
        throw new Error(String(i18n.t('txGuard.builtTxMismatch')));
      }

      // ── 2. Sign via background. Hardware wallets and Keystone require an
      // interactive UI flow that's out of scope for this composable; the Send
      // dialog handles those paths. PRF (passkey) wallets pass pre-decrypted
      // root key bytes and skip password verification (mirrors
      // useTransactionSigning); password wallets verify then sign. ──
      status.value = 'signing';
      const isPrf = !!pkBytes;
      if (!isPrf) {
        if (!password) {
          throw new Error(
            'Spending password is required for Strike deposits from this flow.',
          );
        }
        const passwordVerification = (await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.VERIFY_SPENDING_PASSWORD,
          data: { password },
        })) as BackgroundResponse<VerifyPasswordResponse>;
        if (!passwordVerification.data.success) {
          throw new Error(passwordCheckFailure(passwordVerification, 'Incorrect spending password.'));
        }
      }

      if (!current()) return false;
      requireUnexpired();
      const signResult = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX,
        data: {
          txCbor,
          partialSign: false,
          password: isPrf ? '' : password,
          ...(isPrf && pkBytes ? { privateKeyBytes: Array.from(pkBytes) } : {}),
          utxos,
          addresses: keys,
          mergeWitnesses: false,
        },
      })) as { data?: { witnesses?: string; error?: string } } | null | undefined;

      if (!current()) return false;
      const witnesses = signResult?.data?.witnesses;
      if (signResult?.data?.error || !witnesses) {
        throw new Error(signResult?.data?.error || 'Failed to sign deposit transaction.');
      }

      // ── 3. Submit to chain ──
      requireUnexpired();
      // Submission starts here. Whatever happens next is recorded, even if the review is gone.
      record({ status: 'submitting' });
      status.value = 'submitting';
      const submitResult = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: {
          txCbor,
          witnessHex: witnesses,
          utxos,
        },
      })) as { data?: { txId?: string; error?: string } } | null | undefined;

      if (submitResult?.data?.error) throw new Error(submitResult.data.error);
      const finalTxHash = submitResult?.data?.txId;
      // A lost runtime reply can follow a successful broadcast. Only the worker can acknowledge it,
      // and without its txId there is nothing to confirm with Strike.
      if (typeof finalTxHash !== 'string' || !finalTxHash.trim()) {
        throw new Error(String(i18n.t('errors.submitUnconfirmed')));
      }
      record({ status: 'confirming', txHash: finalTxHash });
      if (current()) {
        txHash.value = finalTxHash;
        status.value = 'confirming';
      }

      // ── 4. Confirm with Strike so they associate this tx with the quote ──
      // This is the FINAL step. Strike's deposit API is quote → build-tx →
      // confirm; `POST /v2/deposit` returns `{ status: "pending" }` and "the
      // backend monitors the blockchain for confirmations" (per Strike's
      // builder reference). There is NO status-poll endpoint — the previous
      // `/v2/transaction/status` poll hit a route that doesn't exist, so every
      // tick 401'd, which tripped the auth interceptor into wiping the keys and
      // showing a "reconnect" prompt on an otherwise-successful deposit.
      try {
        await strikeUserApi.confirmDeposit(confirmedQuote.request_id, finalTxHash);
      } catch (confirmErr) {
        // Soft-fail: the unsigned tx Strike built carries the request_id in its
        // vault datum, so Strike credits the deposit from the on-chain tx even
        // if this confirm call doesn't land. The funds are safe on-chain; don't
        // trip the error state.
        debugLog('[strike-deposit] confirmDeposit warn:', confirmErr);
      }

      // Deposit complete from the wallet's side. We emit 'confirmed' as the
      // terminal status because legacy consumers (the dashboard
      // PerpsAccountSection) listen for 'confirmed'; the
      // side-panel sheet treats 'credited' and 'confirmed' as equivalent. The
      // balance updates on Strike once on-chain confirmations land.
      record({ status: 'confirmed' });
      if (current()) status.value = 'confirmed';
      return true;
    } catch (e) {
      if (wasSubmitted()) {
        record({ status: 'error', error: extractStrikeError(e, 'Failed to build or submit the deposit transaction.') });
      }
      if (!current()) return false;
      const anyErr = e as { response?: { status?: number; data?: unknown } };
      debugLog(
        '[strike-deposit] buildAndSign failed:',
        anyErr?.response?.status ?? '',
        anyErr?.response?.data ?? (e instanceof Error ? e.message : String(e)),
      );
      error.value = extractStrikeError(e, 'Failed to build or submit the deposit transaction.');
      status.value = 'error';
      return false;
    }
  }

  /** Reset all state back to idle. Safe to call at any point. */
  function reset(): void {
    ++quoteRequestVersion;
    quote.value = null;
    status.value = 'idle';
    txHash.value = null;
    error.value = null;
    quoteCountdown.value = 0;
    clearCountdown();
  }

  // Another wallet must not see or sign this wallet's review. A submitted deposit is
  // kept under its own wallet (see `submissions`), so only the review is dropped.
  watch(strikeWalletKey, reset, { flush: 'sync' });

  // Tear down the countdown timer if the last consumer unmounts.
  onUnmounted(() => {
    clearCountdown();
  });

  return {
    // Reactive state
    quote,
    status,
    txHash,
    error,
    isAvailable,
    quoteCountdown,
    adaToUsdRate,
    networkFee,
    depositAddress,
    requiredAmountLovelace,
    // Backwards-compat aliases used by existing components
    isDepositing,
    depositStatus,
    depositError,
    submission,
    // Methods
    requestQuote,
    buildAndSign,
    reset,
    acknowledgeSubmission,
    // Backwards-compat alias used by existing components
    resetDeposit: reset,
  };
}
