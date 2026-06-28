import { ref, computed, onUnmounted } from 'vue';
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

/**
 * Serialise a wallet UTxO to a CIP-30 hex TransactionUnspentOutput — the format
 * Strike's POST /v2/deposit/build-tx `utxos` field expects. Reconstructs the asset
 * Map first (chrome.storage round-trips Map -> plain object, which fromCore can't
 * read). Mirrors getUtxos() in src/chrome/serialization.ts.
 */
function utxoToCip30Hex(utxo: Cardano.Utxo): string {
  let value = utxo[1].value;
  if (value?.assets && !(value.assets instanceof Map)) {
    const assetsMap = new Map<Cardano.AssetId, bigint>();
    Object.entries(value.assets as Record<string, unknown>).forEach(([assetId, qty]) => {
      assetsMap.set(assetId as Cardano.AssetId, BigInt(qty as string | number | bigint));
    });
    value = { coins: BigInt(value.coins), assets: assetsMap };
  } else if (value) {
    value = { coins: BigInt(value.coins), assets: value.assets || undefined };
  }
  return String(
    Serialization.TransactionUnspentOutput.fromCore([
      { txId: utxo[0].txId, index: utxo[0].index },
      {
        address: utxo[1].address,
        value,
        datumHash: utxo[1].datumHash,
        datum: utxo[1].datum,
        scriptReference: utxo[1].scriptReference,
      },
    ]).toCbor(),
  );
}

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
const requestId = ref<string | null>(null);
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
        'Strike could not quote this deposit. Try a larger amount — there may be a minimum.',
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
      // ── 1. Ask STRIKE to build the deposit tx (POST /v2/deposit/build-tx). ──
      // Strike constructs the real vault deposit — correct script/datum + the
      // builder fee — and returns an unsigned CBOR. We must NOT build our own
      // transfer to the deposit address: a plain ADA send to the vault script is
      // NOT a creditable Strike deposit (that's why a self-built deposit didn't
      // credit). The wallet only signs + submits what Strike builds.
      status.value = 'building';
      const cip30Utxos = utxos.map(utxoToCip30Hex);
      const buildResp = await strikeUserApi.buildDepositTx({
        request_id: requestId.value,
        user_address: wallet.baseAddress,
        utxos: cip30Utxos,
      });
      if (!buildResp?.unsigned_tx) {
        throw new Error('Strike did not return an unsigned deposit transaction.');
      }

      const transaction = Serialization.Transaction.fromCbor(HexBlob(buildResp.unsigned_tx));
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

      // The on-chain txId returned by the submitter (validated non-empty above).
      const finalTxHash = submitResult.data.txId;
      txHash.value = finalTxHash;

      // ── 4. Confirm with Strike so they associate this tx with the quote ──
      // This is the FINAL step. Strike's deposit API is quote → build-tx →
      // confirm; `POST /v2/deposit` returns `{ status: "pending" }` and "the
      // backend monitors the blockchain for confirmations" (per Strike's
      // builder reference). There is NO status-poll endpoint — the previous
      // `/v2/transaction/status` poll hit a route that doesn't exist, so every
      // tick 401'd, which tripped the auth interceptor into wiping the keys and
      // showing a "reconnect" prompt on an otherwise-successful deposit.
      status.value = 'confirming';
      try {
        await strikeUserApi.confirmDeposit(requestId.value, finalTxHash);
      } catch (confirmErr) {
        // Soft-fail: the unsigned tx Strike built carries the request_id in its
        // vault datum, so Strike credits the deposit from the on-chain tx even
        // if this confirm call doesn't land. The funds are safe on-chain; don't
        // trip the error state.
        debugLog('[strike-deposit] confirmDeposit warn:', confirmErr);
      }

      // Deposit complete from the wallet's side. We emit 'confirmed' as the
      // terminal status because legacy consumers (the dashboard
      // PerpsAccountSection / VaultDepositSheet) listen for 'confirmed'; the
      // side-panel sheet treats 'credited' and 'confirmed' as equivalent. The
      // balance updates on Strike once on-chain confirmations land.
      status.value = 'confirmed';
      return true;
    } catch (e) {
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
