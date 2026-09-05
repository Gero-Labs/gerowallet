/**
 * Evaluating a wallet's PassKey PRF, with the credential's location remembered.
 *
 * This exists because the remembering is easy to forget. `evaluatePrfForWallet`
 * takes the stored transports and a callback to record newly-learned ones, and
 * every caller has to pass BOTH for a wallet to stop seeing the browser's full
 * authenticator picker. Wire one and not the other — as five of the six call
 * sites originally did — and that flow keeps prompting with phone and security
 * key in front of a Windows Hello credential, forever, while the flow next to it
 * behaves. Nothing about the code makes that visible.
 *
 * So the pairing lives here instead, and call sites pass a wallet.
 *
 * The recording is deliberately fire-and-forget: it is an optimisation of the
 * NEXT prompt, and this one has already succeeded. A failed write must not turn
 * a completed authentication into an error.
 */

import { evaluatePrfForWallet } from '@/shared/utils/webauthn-prf';

/** What this needs off a wallet record. Structural, so any caller's shape fits. */
export interface PrfWalletRef {
  id: number;
  webAuthnCredentialId: string;
  webAuthnTransports?: AuthenticatorTransport[] | null;
}

/**
 * The wallet's PRF output, prompting for the right authenticator where we know
 * which one it is, and learning it where we do not.
 */
export async function evaluateWalletPrf(wallet: PrfWalletRef): Promise<ArrayBuffer> {
  return evaluatePrfForWallet(
    wallet.webAuthnCredentialId,
    wallet.id.toString(),
    wallet.webAuthnTransports,
    learned => {
      void import('@/db/gero-db')
        .then(({ setWalletWebAuthnTransports }) => setWalletWebAuthnTransports(wallet.id, learned))
        .catch(error => console.error('Could not record PassKey transports:', error));
    },
  );
}
