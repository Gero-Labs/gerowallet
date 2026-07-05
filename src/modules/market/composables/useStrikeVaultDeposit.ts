import { ref } from 'vue';
import type { DepositStatus } from './useStrikeDeposit';

/**
 * Vault deposit quote — extends the direct deposit quote with a `vault_id`
 * parameter so the Strike validator knows which vault to credit.
 *
 * TODO: Confirm field names against the final Strike v2 vault deposit spec
 *       once the endpoint is published. All fields mirror the direct deposit
 *       quote shape (`DepositQuote` in `useStrikeDeposit.ts`).
 */
export interface VaultDepositQuote {
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
  /**
   * The vault that will receive the credited funds once the on-chain deposit
   * is confirmed by the Strike validators.
   */
  vault_id: string;
}

// ---------------------------------------------------------------------------
// Singleton state — only one vault deposit can be in flight at a time.
// ---------------------------------------------------------------------------

const quote = ref<VaultDepositQuote | null>(null);
const status = ref<DepositStatus>('idle');
const txHash = ref<string | null>(null);
const error = ref<string | null>(null);

/**
 * Whether the vault deposit flow is wired to a real Strike endpoint.
 * The deposit-quote endpoint is not yet published, so this is `false` and the
 * UI should render a disabled / "coming soon" state instead of attempting a
 * quote. Flip to `true` once the endpoint and field shapes are confirmed.
 */
const available = ref(false);

/**
 * User-facing reason the flow is unavailable. Kept as a plain string here
 * because i18n keys are owned by the parity stream; callers should map this to
 * a translated "coming soon" message when surfacing it.
 */
const unavailableReason = 'Vault deposits are coming soon.';

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/**
 * Request a deposit quote for a specific vault.
 *
 * @param vaultId   - The target vault's unique identifier. Passed to the
 *                    Strike validator API so the deposit is attributed to the
 *                    correct vault on confirmation.
 * @param amountAda - Amount the user wishes to deposit, in ADA (not lovelace).
 *
 * TODO: Replace the thrown error below with a real API call once the Strike
 *       v2 vault deposit-quote endpoint is confirmed.
 * Expected shape (subject to change):
 *   POST /v2/vault/deposit/quote
 *   Body: { vault_id: string, amount: string, asset: 'ADA', chain: 'cardano' }
 *   Response: VaultDepositQuote
 */
async function requestVaultDepositQuote(vaultId: string, amountAda: number): Promise<void> {
  // The Strike vault deposit-quote endpoint is not yet published. Rather than
  // throwing (which surfaced as an error toast and could crash callers that
  // don't catch), enter a clean disabled state so the UI can render a
  // "coming soon" affordance. Do NOT fabricate an endpoint.
  void vaultId;
  void amountAda;
  if (!available.value) {
    error.value = unavailableReason;
    status.value = 'idle';
    return;
  }

  // TODO: Replace with actual Strike vault deposit-quote endpoint once published.
  // Expected: POST /v2/vault/deposit/quote { vault_id, amount, asset: 'ADA', chain: 'cardano' }
  // Map the response to VaultDepositQuote and assign to quote.value.
}

/**
 * Build, sign, submit, and confirm the vault deposit transaction.
 *
 * Must be called after a successful `requestVaultDepositQuote()` (i.e.
 * `quote.value` is non-null and not expired).
 *
 * ## On-chain flow
 * Vault deposits go through the same on-chain lifecycle as direct Strike
 * account deposits:
 *
 * 1. ADA is sent from the user's wallet to the Strike locker contract address
 *    (`quote.lockerAddress`) for exactly `quote.requiredAmount` lovelace.
 * 2. Strike validators detect the confirmed UTxO and perform an automatic
 *    stablecoin swap (ADA → USDC/USDM) at the prevailing oracle price.
 * 3. The resulting USD equivalent is credited to the user's Strike account,
 *    specifically to the vault identified by `quote.vault_id` rather than
 *    the user's general trading balance.
 *
 * The difference between a direct deposit and a vault deposit is therefore
 * only at the API layer: the quote request includes a `vault_id` param, and
 * the validator routes the credit accordingly. The Cardano transaction itself
 * is identical in both cases.
 *
 * @param password - The wallet's spending password (pass an empty string for
 *   hardware wallets or PassKey wallets — the signing step will use the
 *   appropriate authentication path instead).
 *
 * TODO: Integrate with existing Cardano transaction builder:
 *   - Use `builder.ts` / `walletBg.ts` send-ADA flow, targeting
 *     `quote.value.lockerAddress` for `quote.value.requiredAmount` lovelace.
 *   - Reuse the existing sign-and-submit pipeline (same as the Send screen).
 *   - For the confirming step, call the Strike vault confirmation polling
 *     endpoint (TBD) until status becomes 'credited' or the quote expires.
 */
async function buildAndSign(password: string): Promise<void> {
  if (!available.value) {
    error.value = unavailableReason;
    status.value = 'idle';
    return;
  }
  if (!quote.value) {
    error.value = 'No active vault deposit quote. Call requestVaultDepositQuote() first.';
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
    void password;
    // const signedTx = await signTx(tx, password);

    // TODO: Submit to the Cardano blockchain.
    status.value = 'submitting';
    // txHash.value = await submitTx(signedTx);

    // TODO: Poll Strike validator vault confirmation endpoint until credited.
    //       Expected: GET /v2/vault/deposit/status?quoteId=&txHash=&vault_id=
    status.value = 'confirming';
    // await pollForVaultCredit(quote.value.quoteId, txHash.value, quote.value.vault_id);

    // status.value = 'credited';
  } catch (e: any) {
    error.value = e.message;
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

// ---------------------------------------------------------------------------
// Composable export
// ---------------------------------------------------------------------------

/**
 * Composable for the Strike Finance vault deposit flow.
 *
 * Follows the singleton pattern — all callers share the same reactive state,
 * ensuring only one vault deposit is in flight at a time.
 *
 * ## Lifecycle
 * 1. `requestVaultDepositQuote(vaultId, amountAda)` — obtain a locker address,
 *    required amount, expiry, and vault attribution from the Strike API.
 *    Sets `status` to `'quoting'`.
 * 2. `buildAndSign(password)` — build a Cardano transaction to the locker
 *    contract, sign, submit, and poll for validator confirmation. Status
 *    transitions: `'building'` → `'signing'` → `'submitting'` →
 *    `'confirming'` → `'credited'`.
 * 3. `reset()` — clear all state back to `'idle'`.
 *
 * See `useStrikeDeposit.ts` for the direct (non-vault) deposit flow.
 */
export function useStrikeVaultDeposit() {
  return {
    quote,
    status,
    txHash,
    error,
    available,
    unavailableReason,
    requestVaultDepositQuote,
    buildAndSign,
    reset,
  };
}
