/**
 * Placeholder from the scaffolding: what the vault screens read from the route and the logged
 * wallet to host the other screens' components (`MIDNIGHT_VAULT_HOSTED` in `../contracts.ts`).
 * This folder may replace it.
 */
import { computed, type ComputedRef } from 'vue';
import { useRoute } from 'vue-router';
import { walletStore } from '@/stores/walletStore';
import { secretsWalletId } from '@/shared/utils/walletAccount';

export interface MidnightVaultRoute {
  /** `secretsWalletId` of the logged wallet: the store key of its vaults. Undefined without one. */
  readonly walletId: ComputedRef<number | undefined>;
  /** The route's `:vaultId`, or '' outside a vault. */
  readonly vaultId: ComputedRef<string>;
}

export function useMidnightVaultRoute(): MidnightVaultRoute {
  const route = useRoute();
  return {
    walletId: computed(() => {
      const wallet = walletStore.loggedWallet as { id?: unknown; secretsWalletId?: number } | null;
      return wallet && typeof wallet.id === 'number' ? secretsWalletId({ id: wallet.id, secretsWalletId: wallet.secretsWalletId }) : undefined;
    }),
    vaultId: computed(() => String(route.params['vaultId'] ?? '')),
  };
}
