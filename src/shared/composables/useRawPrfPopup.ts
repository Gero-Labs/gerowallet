import { useTranslation } from '@/shared/composables/useTranslation';
import { StaleApprovalError } from '@/shared/composables/useApprovalFreshness';

/** Midnight side-panel actions run the PassKey ceremony in the extension's authentication popup. */
export function useRawPrfPopup() {
  const { t } = useTranslation();
  const pendingPopups = new Set<() => void>();
  const cancelPopups = () => pendingPopups.forEach(cancel => cancel());

  function requestRawPrf(current: () => boolean, walletId?: number): Promise<Uint8Array> {
    if (!current()) return Promise.reject(new StaleApprovalError());
    // A registration or sponsor can bind the popup to its exact wallet.
    const target = walletId == null ? '' : `&walletId=${encodeURIComponent(String(walletId))}`;
    const popupUrl = chrome.runtime.getURL(`index.html?mode=rawPrf${target}#/passkey-auth`);
    const popup = window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');
    if (!popup) return Promise.reject(new Error(t('errors.popupBlocked')));

    return new Promise((resolve, reject) => {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const cleanup = () => {
        window.removeEventListener('message', handler);
        clearTimeout(timeout);
        pendingPopups.delete(cancel);
        popup.close();
      };
      const cancel = () => { cleanup(); reject(new StaleApprovalError()); };
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin || event.source !== popup) return;
        if (event.data?.type === 'PASSKEY_AUTH_RESULT') {
          cleanup();
          const { success, prfOutput, error } = event.data.payload ?? {};
          if (success && Array.isArray(prfOutput) && prfOutput.length > 0) {
            const bytes = new Uint8Array(prfOutput);
            if (!current()) { bytes.fill(0); reject(new StaleApprovalError()); }
            else resolve(bytes);
          }
          else reject(new Error(error || t('security.passKeyAuthFailed')));
        }
      };
      window.addEventListener('message', handler);
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(t('errors.authenticationTimeout')));
      }, 60000);
      pendingPopups.add(cancel);
    });
  }

  return { requestRawPrf, cancelPopups };
}
