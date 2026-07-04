/**
 * Shape of the `{ id, data, target, sender }` envelope the background's MPC
 * "Sign in with Google" handlers (SIGN_WITH_GOOGLE, CREATE_MPC_GOOGLE_WALLET,
 * UNLOCK_MPC_WALLET, RECOVER_MPC_GOOGLE_WALLET) reply with. A single loose
 * shape is shared across the onboarding steps instead of `any` — each handler
 * only ever populates the fields relevant to itself.
 */
export interface GoogleWalletBgResponse {
  data?: {
    success?: boolean;
    error?: string;
    tokens?: { idToken: string; accessToken: string };
    walletId?: number;
    recoveryShare?: string;
    publicKey?: string;
  };
  error?: string;
}
