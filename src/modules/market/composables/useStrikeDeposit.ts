import { ref } from 'vue';

/**
 * Strike v2 deposit quote returned by the validator API.
 *
 * TODO: Confirm field names against the final Strike v2 spec once the
 *       deposit-quote endpoint is published. All fields listed here are
 *       derived from the pre-release design document.
 */
export interface DepositQuote {
  /** Bech32 Cardano address of the on-chain locker contract. */
  lockerAddress: string;
  /** Exact amount the user must send, in lovelace. */
  requiredAmount: string;
  /** Estimated USD credit after the validator performs the stablecoin swap. */
  estimatedUsdCredit: string;
  /** Quote expiry timestamp (Unix ms). Transaction must be submitted before this. */
  expiresAt: number;
  /** Opaque identifier used when polling for confirmation or reporting issues. */
  quoteId: string;
}

/**
 * Lifecycle states for the deposit flow.
 *
 * idle       → no active deposit
 * quoting    → waiting for validator to return a deposit quote
 * building   → constructing the Cardano transaction to the locker address
 * signing    → awaiting spending-password / hardware-wallet / PassKey signature
 * submitting → broadcasting the signed transaction to the blockchain
 * confirming → polling for on-chain confirmation and validator balance credit
 * credited   → deposit confirmed; Strike balance updated
 * error      → unrecoverable error; see `error` ref for the message
 */
export type DepositStatus =
  | 'idle'
  | 'quoting'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'credited'
  | 'error';

// Module-level refs so the state is shared across component instances within
// the same extension context. Each caller that calls useStrikeDeposit() gets
// the same reactive state, which is intentional — only one deposit can be in
// flight at a time.
const quote = ref<DepositQuote | null>(null);
const status = ref<DepositStatus>('idle');
const txHash = ref<string | null>(null);
const error = ref<string | null>(null);

/**
 * Composable for the Strike v2 on-chain deposit flow.
 *
 * ## Lifecycle
 * 1. `requestQuote(amountAda)` — calls the Strike validator API to obtain a
 *    locker address, required amount, and expiry.  Sets `status` to `'quoting'`.
 * 2. `buildAndSign(password)` — builds a Cardano transaction that sends the
 *    required lovelace to the locker contract, signs it with the active wallet
 *    (spending password / hardware wallet / PassKey), submits it, then polls
 *    until the validator credits the balance.  Status transitions:
 *    `'building'` → `'signing'` → `'submitting'` → `'confirming'` → `'credited'`.
 * 3. `reset()` — clears all state back to `'idle'`.
 *
 * ## TODOs (API not yet confirmed)
 * - `requestQuote`: POST endpoint path, request shape, and response shape are
 *   all pending the Strike v2 spec.  See inline TODO comments.
 * - `buildAndSign`: Wire into the existing wallet transaction builder
 *   (`builder.ts` / `walletBg.ts`) and submission pipeline once the quote
 *   shape is confirmed.
 * - Polling strategy for `'confirming'` state: interval, max attempts, and
 *   the confirmation endpoint are all TBD.
 */
export function useStrikeDeposit() {
  /**
   * Step 1: Obtain a deposit quote from the Strike validators.
   *
   * @param amountAda - Amount the user wishes to deposit, in ADA (not lovelace).
   *
   * TODO: Replace the thrown error below with a real API call once the Strike
   *       v2 deposit-quote endpoint is confirmed.
   * Expected shape (subject to change):
   *   POST /v2/deposit/quote
   *   Body: { amount: string, asset: 'ADA', chain: 'cardano' }
   *   Response: DepositQuote
   */
  async function requestQuote(_amountAda: number): Promise<void> {
    // The Strike v2 deposit-quote endpoint is not yet published. Until it is,
    // surface a friendly "coming soon" message instead of throwing — that way
    // the calling UI can read `error` / `isAvailable` and hide or disable the
    // deposit affordance gracefully.
    status.value = 'idle';
    quote.value = null;
    error.value = 'Deposits coming soon — Strike validator endpoint not yet available.';
  }

  /** True once the Strike deposit endpoint is wired in. UIs can gate buttons on this. */
  const isAvailable = ref(false);

  /**
   * Steps 2–4: Build the transaction, sign it, submit it, and wait for
   * confirmation.
   *
   * Must be called after a successful `requestQuote()` (i.e. `quote.value` is
   * non-null and not expired).
   *
   * @param password - The wallet's spending password (pass an empty string for
   *   hardware wallets or PassKey wallets — the signing step will use the
   *   appropriate authentication path instead).
   *
   * TODO: Integrate with existing Cardano transaction builder:
   *   - Use `builder.ts` / `walletBg.ts` send-ADA flow, targeting
   *     `quote.value.lockerAddress` for `quote.value.requiredAmount` lovelace.
   *   - Reuse the existing sign-and-submit pipeline (same as the Send screen).
   *   - For the confirming step, call the Strike confirmation polling endpoint
   *     (TBD) until status becomes 'credited' or the quote expires.
   */
  async function buildAndSign(password: string): Promise<void> {
    if (!quote.value) {
      error.value = 'No active deposit quote. Call requestQuote() first.';
      status.value = 'error';
      return;
    }

    try {
      // TODO: Build a Cardano transaction sending quote.value.requiredAmount
      //       lovelace to quote.value.lockerAddress.
      status.value = 'building';
      // const tx = await buildSendAdaTx(quote.value.lockerAddress, quote.value.requiredAmount);

      // TODO: Sign with spending password / hardware wallet / PassKey.
      status.value = 'signing';
      // const signedTx = await signTx(tx, password);

      // TODO: Submit to the Cardano blockchain.
      status.value = 'submitting';
      // txHash.value = await submitTx(signedTx);

      // TODO: Poll Strike validator confirmation endpoint until credited.
      //       Expected: GET /v2/deposit/status?quoteId=&txHash=
      status.value = 'confirming';
      // await pollForCredit(quote.value.quoteId, txHash.value);

      // status.value = 'credited';
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      status.value = 'error';
    }
  }

  /** Reset all state back to idle. Safe to call at any point in the lifecycle. */
  function reset(): void {
    quote.value = null;
    status.value = 'idle';
    txHash.value = null;
    error.value = null;
  }

  return { quote, status, txHash, error, isAvailable, requestQuote, buildAndSign, reset };
}
