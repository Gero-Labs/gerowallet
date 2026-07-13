import { useTranslation } from '@/shared/composables/useTranslation';

/** Raw PRF re-auth material for an MPC passkey wallet. Never logged. */
export interface MpcPasskeySecret {
  prfOutputHex: string;
  webAuthnCredentialId: string;
  mpcPrfSaltId: string;
}

/**
 * WebAuthn cannot run reliably in a Chrome side panel / dialog context, so the
 * MPC passkey PRF ceremony is delegated to a popup window
 * (index.html?mode=mpcPrf#/passkey-auth) — the same pattern LockScreen.vue's
 * local `evaluateMpcPasskeyViaPopup` uses for the unlock flow. This shared
 * version lets Settings dialogs (change recovery password, reveal SRP) reuse
 * it instead of duplicating the ~30-line popup/postMessage plumbing.
 *
 * Resolves the raw prfOutputHex (never logged, never persisted). Rejects with
 * an Error('cancelled') on user cancel so callers can abort silently, and
 * rejects with a translated message on popup-blocked / timeout / failure.
 */
export function evaluateMpcPasskeyViaPopup(walletId: number): Promise<MpcPasskeySecret> {
  const { t } = useTranslation();
  return new Promise((resolve, reject) => {
    const popupUrl = chrome.runtime.getURL(`index.html?mode=mpcPrf&walletId=${walletId}#/passkey-auth`);
    const popup = window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');
    if (!popup) {
      reject(new Error(t('errors.popupBlocked')));
      return;
    }

    const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', handler);
      clearTimeout(timeoutId);
      try { popup.close(); } catch { /* already closed */ }
    };

    const handler = (event: MessageEvent) => {
      if (event.origin !== extensionOrigin) return;
      if (event.data?.type !== 'PASSKEY_AUTH_RESULT') return;
      if (settled) return;
      settled = true;

      const { success, prfOutputHex, webAuthnCredentialId, mpcPrfSaltId, cancelled, error: err } = event.data.payload || {};
      cleanup();
      if (success && prfOutputHex) {
        resolve({ prfOutputHex, webAuthnCredentialId, mpcPrfSaltId });
      } else {
        reject(new Error(cancelled ? 'cancelled' : (err || t('security.passKeyAuthFailed'))));
      }
    };

    window.addEventListener('message', handler);
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(t('errors.authenticationTimeout')));
    }, 120000);
  });
}
