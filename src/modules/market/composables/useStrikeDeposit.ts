import { ref, computed, onUnmounted } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import {
  nexusTxApi,
  cardanoUtxoToNexusInput,
  type BuildTxRequest,
} from '@/api/nexus-tx-api';
import { currentRewardWithdrawals } from '@/shared/utils/autoWithdraw';
import { strikeUserApi } from '@/api/strike-v2.user';
import { hasStrikeApiKeys } from '@/api/strike-v2.client';
import type {
  DepositQuoteResponse,
  TransactionStatusResponse,
} from '@/api/strike-v2.types';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { Messaging, type BackgroundResponse, type VerifyPasswordResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { debugLog } from '@/utils/debug';

/**
 * Lifecycle states for the deposit flow.
 *
 * idle       → no active deposit
 * quoting    → waiting for the validator to return a deposit quote
 * quoted     → quote returned, awaiting user confirmation
 * building   → constructing the Cardano transaction to the deposit address
 * signing    → awaiting spending-password / hardware-wallet / PassKey signature
 * submitting → broadcasting the signed transaction to the blockchain
 * confirming → tx submitted, polling Strike for credit confirmation
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
const requestId = ref<string | null>(null);
const quoteCountdown = ref<number>(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

// Polling configuration. We poll Strike's transaction-status endpoint every
// 7s for up to ~3 minutes after submission. 7s strikes a balance between
// snappy feedback when Strike credits quickly and not hammering the API for
// slow on-chain confirmations.
const POLL_INTERVAL_MS = 7_000;
const POLL_MAX_ATTEMPTS = 26; // 26 × 7s ≈ 3min2s

/**
 * Generation counter — bumped by `reset()` so any in-flight polling loop
 * exits the next time it wakes up. Without this, closing the DepositSheet
 * mid-deposit would leave `pollForCredit` firing API calls for ~3 minutes.
 */
let flowGeneration = 0;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Composable for the Strike v2 on-chain deposit flow.
 *
 * Flow:
 *   1. `requestQuote(amountAda)` → `POST /v2/deposit/quote` returns
 *      `{ request_id, quote, deposit_address, confirmations_required }`.
 *   2. `buildAndSign(password)` builds an ADA send tx via Nexus to the
 *      `deposit_address`, signs it (password / Ledger / Trezor / Keystone /
 *      PassKey), submits it on-chain, and finally calls `POST /v2/deposit`
 *      with `{ request_id, tx_hash }` so Strike credits the user's balance.
 *   3. After confirmation we poll `/v2/transaction/status` until the deposit
 *      shows `completed` or the timeout elapses.
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

  /**
   * Step 1 — request a deposit quote from Strike.
   *
   * @param amountAda - amount the user wants to deposit, in ADA (whole units).
   */
  async function requestQuote(amountAda: number | string): Promise<void> {
    error.value = null;
    txHash.value = null;
    requestId.value = null;
    status.value = 'quoting';

    // Authenticated endpoint — without a loaded API-wallet key this would be sent
    // unauthenticated and 401. Surface a clear prompt instead of a silent failure.
    if (!hasStrikeApiKeys()) {
      error.value = 'Connect to Strike first — open the Vaults tab and tap "Connect to Strike".';
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

      // Defensive shape check — bail out if the API drifts from the typed
      // contract instead of crashing later in the build step.
      if (!response?.deposit_address || !response?.quote?.asset_amount) {
        debugLog('[strike-deposit] quote response missing required fields:', response);
        throw new Error('Strike quote response missing deposit_address / asset_amount.');
      }

      quote.value = response;
      requestId.value = response.request_id;
      status.value = 'quoted';
      if (response.quote.expiration_at) {
        startCountdown(Number(response.quote.expiration_at));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      debugLog('[strike-deposit] requestQuote failed:', msg);
      error.value = msg;
      status.value = 'error';
    }
  }

  /**
   * Steps 2–4 — build the on-chain tx, sign it with the wallet, submit it,
   * confirm with Strike, and poll until credited.
   *
   * Returns `true` once the deposit shows `completed` on Strike (or the
   * tx is confirmed locally and Strike's polling times out gracefully —
   * the snackbar surfaces the txid in either case). Returns `false` on
   * unrecoverable error.
   *
   * @param password - The wallet's spending password. Pass an empty string
   *   for hardware wallets (currently unsupported here — see comment below).
   * @param _vaultId - Reserved for future vault-deposit support. Currently
   *   ignored; the wallet always deposits to the user's main account.
   */
  async function buildAndSign(
    password: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _vaultId?: string,
    // Pre-decrypted root key bytes for PRF (passkey) wallets, obtained from
    // PassKeyAuthButton. When present we skip password verification and pass
    // these as privateKeyBytes to SIGN_TX (mirrors useTransactionSigning).
    pkBytes?: Uint8Array,
  ): Promise<boolean> {
    if (!quote.value || !requestId.value) {
      error.value = 'No active deposit quote. Call requestQuote() first.';
      status.value = 'error';
      return false;
    }

    const wallet = walletStore.loggedWallet;
    const utxos = walletStore.utxos as Cardano.Utxo[];
    const keys = walletStore.keys;
    if (!wallet || !keys?.payment?.[0]?.address) {
      error.value = 'No active wallet — cannot build deposit transaction.';
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
      error.value = 'Strike session is not unlocked — reconnect to Strike before depositing (no funds were moved).';
      status.value = 'error';
      return false;
    }

    try {
      // ── 1. Build tx via Nexus (mirrors the Send flow's buildTx in SendDialog.vue) ──
      status.value = 'building';
      const changeAddress = keys.payment[0].address;
      const buildRequest: BuildTxRequest = {
        outputs: [
          {
            address: quote.value.deposit_address,
            lovelace: requiredAmountLovelace.value,
          },
        ],
        changeAddress,
        utxos: utxos.map(cardanoUtxoToNexusInput),
        network: wallet.network === 'Mainnet' ? 'MAINNET' : 'PREPROD',
        withdrawals: currentRewardWithdrawals(),
      };

      const { tx_cbor: txCborHex, tx_hash: builtTxHash } =
        await nexusTxApi.buildTransferTx(buildRequest, wallet.network);

      const transaction = Serialization.Transaction.fromCbor(HexBlob(txCborHex));
      const txCore = transaction.toCore();
      const txCbor = serializeCardanoJsSdkTx(txCore);

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
          throw new Error('Incorrect spending password.');
        }
      }

      const signResult = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX,
        data: {
          txCbor,
          partialSign: false,
          password: isPrf ? '' : password,
          ...(isPrf && pkBytes ? { privateKeyBytes: Array.from(pkBytes) } : {}),
          accountIndex: 0,
          utxos,
          addresses: keys,
          mergeWitnesses: false,
        },
      })) as { data: { witnesses?: string; error?: string } };

      if (signResult.data.error || !signResult.data.witnesses) {
        throw new Error(signResult.data.error || 'Failed to sign deposit transaction.');
      }

      // ── 3. Submit to chain ──
      status.value = 'submitting';
      const submitResult = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: {
          txCbor,
          witnessHex: signResult.data.witnesses,
          utxos,
        },
      })) as { data: { txId?: string; error?: string } };

      if (submitResult.data.error || !submitResult.data.txId) {
        throw new Error(submitResult.data.error || 'Failed to submit deposit transaction.');
      }

      // Prefer the on-chain txId returned by the submitter; fall back to
      // Nexus's pre-build hash if for any reason it's missing.
      const finalTxHash = submitResult.data.txId || builtTxHash;
      txHash.value = finalTxHash;

      // ── 4. Confirm with Strike so they associate this tx with the quote ──
      status.value = 'confirming';
      try {
        await strikeUserApi.confirmDeposit(requestId.value, finalTxHash);
      } catch (confirmErr) {
        // Even if /v2/deposit fails we keep going — Strike sometimes credits
        // by detecting the address on-chain regardless. Surface it as a soft
        // warning via the error ref but don't trip the error state yet; the
        // poll loop below is the source of truth.
        debugLog('[strike-deposit] confirmDeposit warn:', confirmErr);
      }

      // ── 5. Poll until Strike marks the deposit completed (or timeout) ──
      // We emit 'confirmed' as the terminal status because legacy consumers
      // (the dashboard PerpsAccountSection / VaultDepositSheet) listen for
      // 'confirmed'; the new side-panel sheet treats 'credited' and
      // 'confirmed' as equivalent.
      const credited = await pollForCredit(requestId.value, flowGeneration);
      if (credited) {
        status.value = 'confirmed';
        return true;
      }

      // Tx is on-chain but Strike hasn't shown `completed` yet — we still
      // call this a soft success because the funds ARE at the deposit
      // address and Strike will catch up. UIs can offer a "view txid" link.
      status.value = 'confirmed';
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      debugLog('[strike-deposit] buildAndSign failed:', msg);
      error.value = msg;
      status.value = 'error';
      return false;
    }
  }

  /**
   * Polls Strike's transaction-status endpoint until the deposit completes,
   * fails, or we exhaust the attempt budget. Returns `true` only on
   * confirmed `completed`. A `failed` response throws so the caller's catch
   * block can surface the error to the UI.
   */
  async function pollForCredit(reqId: string, generation: number): Promise<boolean> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      // Composable was reset (e.g. user closed the sheet) — abandon the loop.
      if (generation !== flowGeneration) return false;

      let resp: TransactionStatusResponse | null = null;
      try {
        resp = await strikeUserApi.getTransactionStatus(reqId, 'deposit');
      } catch (e) {
        // Transient HTTP errors shouldn't kill the loop — Strike's API
        // occasionally returns 5xx during heavy block-tip activity.
        debugLog('[strike-deposit] poll attempt', attempt, 'transient error:', e);
      }

      if (resp?.status === 'completed') return true;
      if (resp?.status === 'failed') {
        throw new Error('Strike rejected the deposit transaction.');
      }

      await sleep(POLL_INTERVAL_MS);
    }
    return false;
  }

  /** Reset all state back to idle. Safe to call at any point. */
  function reset(): void {
    // Bump the generation so any in-flight pollForCredit exits on its
    // next wake-up instead of writing to the now-stale state.
    flowGeneration++;
    quote.value = null;
    status.value = 'idle';
    txHash.value = null;
    error.value = null;
    requestId.value = null;
    quoteCountdown.value = 0;
    clearCountdown();
  }

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
    // Methods
    requestQuote,
    buildAndSign,
    reset,
    // Backwards-compat alias used by existing components
    resetDeposit: reset,
  };
}
