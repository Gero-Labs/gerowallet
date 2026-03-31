import { ref } from 'vue';

/**
 * Strike v2 withdrawal quote returned by the validator API.
 *
 * TODO: Confirm field names against the final Strike v2 spec once the
 *       withdraw-quote endpoint is published. All fields listed here are
 *       derived from the pre-release design document.
 */
export interface WithdrawQuote {
  /**
   * Raw message string the user must sign with their Cardano wallet's Ed25519
   * key.  The signature is what authorises the validator to release funds.
   */
  message: string;
  /** Estimated ADA (or token) amount the user will receive, as a string. */
  estimatedAmount: string;
  /** Estimated on-chain settlement time in milliseconds. */
  estimatedDeliveryMs: number;
  /** Quote expiry timestamp (Unix ms). Signature must be submitted before this. */
  expiresAt: number;
  /** Opaque identifier used when submitting the signed quote to validators. */
  quoteId: string;
  /**
   * Whether the withdrawal is safe given the user's current open positions /
   * margin levels.  The UI should warn (or block) if this is false.
   */
  marginSafe: boolean;
}

/**
 * Lifecycle states for the withdrawal flow.
 *
 * idle       → no active withdrawal
 * quoting    → waiting for validators to return a withdrawal quote
 * signing    → awaiting Ed25519 message signature from the wallet
 * submitting → sending the signed quote to the Strike validators
 * pending    → validators are processing; waiting for on-chain settlement
 * settled    → funds delivered to the user's destination address
 * error      → unrecoverable error; see `error` ref for the message
 */
export type WithdrawStatus =
  | 'idle'
  | 'quoting'
  | 'signing'
  | 'submitting'
  | 'pending'
  | 'settled'
  | 'error';

// Module-level refs so the state is shared across component instances within
// the same extension context.  Only one withdrawal can be in flight at a time.
const quote = ref<WithdrawQuote | null>(null);
const status = ref<WithdrawStatus>('idle');
const error = ref<string | null>(null);

/**
 * Composable for the Strike v2 message-signed withdrawal flow.
 *
 * ## Lifecycle
 * 1. `requestQuote(amountUsd, asset, destinationAddress)` — calls the Strike
 *    validator API to obtain a message to sign, estimated delivery time, and
 *    expiry.  Sets `status` to `'quoting'`.
 * 2. `signAndSubmit(password)` — signs `quote.value.message` with the active
 *    wallet's Ed25519 key (spending password / hardware wallet / PassKey),
 *    then posts the signed quote to the validators.  Status transitions:
 *    `'signing'` → `'submitting'` → `'pending'` → `'settled'`.
 * 3. `reset()` — clears all state back to `'idle'`.
 *
 * ## Validator-side verification (for reference)
 * When the signed message is submitted the validators will check:
 *   a. Ed25519 signature is valid for the user's public key.
 *   b. `quoteId` is still within its expiry window.
 *   c. The current margin position is safe to allow a withdrawal of this size.
 * On success they initiate the on-chain settlement (send funds to
 * `destinationAddress`).
 *
 * ## TODOs (API not yet confirmed)
 * - `requestQuote`: POST endpoint path, request shape, and response shape are
 *   all pending the Strike v2 spec.  See inline TODO comments.
 * - `signAndSubmit`: Wire into the existing wallet message-signing utility
 *   (CIP-8 / `signData`) and confirm the submission endpoint shape.
 * - Polling/webhook strategy for `'pending'` → `'settled'` transition is TBD.
 */
export function useStrikeWithdraw() {
  /**
   * Step 1: Obtain a withdrawal quote from the Strike validators.
   *
   * @param amountUsd         - Amount the user wishes to withdraw, in USD.
   * @param asset             - Asset ticker, e.g. `'ADA'` or a policy-id token.
   * @param destinationAddress - Bech32 Cardano address to receive the funds.
   *
   * TODO: Replace the thrown error below with a real API call once the Strike
   *       v2 withdraw-quote endpoint is confirmed.
   * Expected shape (subject to change):
   *   POST /v2/withdraw/quote
   *   Body: { amount: string, asset: string, address: string, chain: 'cardano' }
   *   Response: WithdrawQuote
   */
  async function requestQuote(
    amountUsd: string,
    asset: string,
    destinationAddress: string,
  ): Promise<void> {
    status.value = 'quoting';
    error.value = null;

    try {
      // TODO: Replace with actual Strike validator API endpoint.
      // Expected: POST /v2/withdraw/quote
      //   { amount: amountUsd, asset, address: destinationAddress, chain: 'cardano' }
      // Map the response to WithdrawQuote and assign to quote.value.
      throw new Error('Withdraw quote API not yet available — endpoint TBD');

      // Unreachable until implemented; placeholder to show intended assignment:
      // quote.value = response as WithdrawQuote;
    } catch (e: any) {
      error.value = e.message;
      status.value = 'error';
    }
  }

  /**
   * Steps 2–3: Sign the quote message with the wallet and submit to validators.
   *
   * Must be called after a successful `requestQuote()` (i.e. `quote.value` is
   * non-null and not expired).
   *
   * @param password - The wallet's spending password (pass an empty string for
   *   hardware wallets or PassKey wallets — the signing step will use the
   *   appropriate authentication path instead).
   *
   * TODO: Integrate with the existing wallet message-signing utility:
   *   - Use CIP-8 `signData` (same path used by DApp connect).
   *   - Sign `quote.value.message` with the payment key of the active wallet.
   *   - Submit to the Strike validator submission endpoint (TBD).
   *   - For the pending step, poll or listen for settlement confirmation.
   *     Possible endpoint: GET /v2/withdraw/status?quoteId=
   */
  async function signAndSubmit(password: string): Promise<void> {
    if (!quote.value) {
      error.value = 'No active withdrawal quote. Call requestQuote() first.';
      status.value = 'error';
      return;
    }

    if (!quote.value.marginSafe) {
      error.value = 'Withdrawal blocked: current margin position is not safe.';
      status.value = 'error';
      return;
    }

    try {
      // TODO: Sign quote.value.message with the wallet's Ed25519 key.
      //       Use the CIP-8 signData flow (same as DApp message signing).
      status.value = 'signing';
      // const signature = await signMessage(quote.value.message, password);

      // TODO: Submit { quoteId, signature, publicKey } to the Strike validators.
      //       Expected: POST /v2/withdraw/submit
      status.value = 'submitting';
      // await submitWithdrawal(quote.value.quoteId, signature);

      // TODO: Poll or subscribe for on-chain settlement.
      //       Expected: GET /v2/withdraw/status?quoteId=
      status.value = 'pending';
      // await pollForSettlement(quote.value.quoteId);

      // status.value = 'settled';
    } catch (e: any) {
      error.value = e.message;
      status.value = 'error';
    }
  }

  /** Reset all state back to idle. Safe to call at any point in the lifecycle. */
  function reset(): void {
    quote.value = null;
    status.value = 'idle';
    error.value = null;
  }

  return { quote, status, error, requestQuote, signAndSubmit, reset };
}
