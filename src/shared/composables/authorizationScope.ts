import { getCurrentInstance, inject, onScopeDispose, watch, type InjectionKey } from 'vue';
import { walletStore } from '@/stores/walletStore';

export interface AuthorizationScope {
  capture: () => () => boolean;
}

export const authorizationScopeKey: InjectionKey<AuthorizationScope> = Symbol('transaction-authorization');

/** Shared by PassKey controls: results belong to the wallet and request that
 * started the ceremony, even when a parent reuses the same component instance. */
export function useAuthenticationFreshness(): AuthorizationScope {
  const parent = getCurrentInstance() ? inject(authorizationScopeKey, null) : null;
  let epoch = 0;
  let disposed = false;
  // Separate sources: a getter returning a fresh array would fire on every
  // re-broadcast of the same wallet, not only when one of these values changes.
  watch([
    () => walletStore.loggedWallet?.id, () => walletStore.loggedWallet?.chain,
    () => walletStore.loggedWallet?.network, () => walletStore.loggedWallet?.webAuthnCredentialId,
    () => walletStore.isLocked,
  ], () => { epoch++; }, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; epoch++; });
  return {
    capture() {
      const ownEpoch = epoch;
      const parentCurrent = parent?.capture();
      return () => !disposed && ownEpoch === epoch && (!parentCurrent || parentCurrent());
    },
  };
}
