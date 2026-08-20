import { Buffer } from 'buffer';
import {
  getPrfSupportMode,
  registerWebAuthnCredentialWithPrf,
  evaluatePrfForWallet,
} from '@/shared/utils/webauthn-prf';

export function mpcPasskeyAvailable(): Promise<boolean> {
  // Platform authenticators only. The Google/MPC onboarding steps render
  // EITHER the passkey button OR the spending-password fields with no toggle
  // between them, so in 'security-key' mode (Brave, external hardware key
  // required) a user without a key would dead-end mid-onboarding. Keep the
  // pre-mode behavior here until those steps grow a password escape hatch.
  return getPrfSupportMode().then((mode) => mode === 'platform');
}

/** Register a NEW platform passkey for an MPC wallet and return the material needed
 *  to encrypt the device share in the background. `mpcPrfSaltId` is a fresh UUID used
 *  as both the WebAuthn user id and the stable PRF salt for this wallet. */
export async function enrollMpcPasskey(
  walletName: string,
): Promise<{ credentialId: string; mpcPrfSaltId: string; prfOutputHex: string }> {
  const mpcPrfSaltId = crypto.randomUUID();
  const { credentialId, prfEnabled, prfOutput } = await registerWebAuthnCredentialWithPrf(mpcPrfSaltId, walletName);
  if (!prfEnabled || !prfOutput) {
    throw new Error('This device could not create a passkey with PRF. Use a spending password instead.');
  }
  return { credentialId, mpcPrfSaltId, prfOutputHex: Buffer.from(new Uint8Array(prfOutput)).toString('hex') };
}

/** Re-evaluate the PRF for an existing MPC passkey (unlock). Returns hex PRF output. */
export async function evaluateMpcPasskey(credentialId: string, mpcPrfSaltId: string): Promise<string> {
  const prfOutput = await evaluatePrfForWallet(credentialId, mpcPrfSaltId);
  return Buffer.from(new Uint8Array(prfOutput)).toString('hex');
}
