/**
 * Shape of the `{ id, data, target, sender }` envelope the background's MPC
 * "Sign in with Google" handlers (SIGN_WITH_GOOGLE, CREATE_MPC_GOOGLE_WALLET,
 * UNLOCK_MPC_WALLET, RECOVER_MPC_GOOGLE_WALLET, DEREGISTER_MPC_ACCOUNT) reply
 * with. A single loose shape is shared across the onboarding steps instead of
 * `any` — each handler only ever populates the fields relevant to itself.
 */
export interface GoogleWalletBgResponse {
  data?: {
    success?: boolean;
    error?: string;
    /** Machine-readable failure reason (currently only CREATE_MPC_GOOGLE_WALLET's
     *  'already_enrolled' 409). Prefer this over matching `error` text. */
    code?: string;
    tokens?: { idToken: string; accessToken: string };
    walletId?: number;
    recoveryShare?: string;
    publicKey?: string;
    /** DEREGISTER_MPC_ACCOUNT result. */
    deregistered?: boolean;
  };
  error?: string;
}

/**
 * The auth material the Secure step collects for an MPC Google wallet —
 * either a freshly-enrolled passkey (PRF) or a spending password. It flows
 * Secure -> Confirm unchanged so Confirm can unlock with the same secret that
 * was just used to create the wallet (no re-prompting the user mid-onboarding).
 */
export type GoogleAuthPayload =
  | { authMethod: 'passkey'; credentialId: string; mpcPrfSaltId: string; prfOutputHex: string }
  | { authMethod: 'password'; spendingPassword: string };

/** Convert a GoogleAuthPayload into the wire fields the background's
 *  CREATE_MPC_GOOGLE_WALLET / UNLOCK_MPC_WALLET handlers expect
 *  (see `buildDeviceShareSecret` in background.ts). Never logged. */
export function authPayloadToWireFields(payload: GoogleAuthPayload): Record<string, string> {
  return payload.authMethod === 'passkey'
    ? { prfOutputHex: payload.prfOutputHex, webAuthnCredentialId: payload.credentialId, mpcPrfSaltId: payload.mpcPrfSaltId }
    : { spendingPassword: payload.spendingPassword };
}
