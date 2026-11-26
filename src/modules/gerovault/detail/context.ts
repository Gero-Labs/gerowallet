/**
 * What the vault list, the vault screen and the recovery screens read from outside: the vault store,
 * the chain reader, the logged-in wallet and the wallet's own CIP-1854 role keys. Each comes from
 * Vue's provide/inject, so a test (or a later caller) hands in its own, and falls back to the
 * wallet's real one.
 */
import { inject, type InjectionKey } from 'vue';
import { vaultStore } from '@/db/vaultStore';
import { walletStore } from '@/stores/walletStore';
import { vaultNetworkOf, type VaultChainReader, type VaultStore } from '@/modules/gerovault/contracts';
import { createVaultChainReader } from '@/modules/gerovault/chain/vaultChainReader';
import type { VaultNetwork } from '@/shared/gerovault';
import { unavailableRoleKeysSource, type VaultRoleKeysSource } from './roleKeys';
import { noFundingVerifier, type FundingVerifier } from './verification';

// -------------------------------------------------------------------------------------------------
// The vault store

export const GEROVAULT_STORE: InjectionKey<VaultStore> = Symbol('gerovault.store');

export function useGerovaultStore(): VaultStore {
  return inject(GEROVAULT_STORE, null) ?? vaultStore;
}

// -------------------------------------------------------------------------------------------------
// The logged-in wallet

export interface GerovaultWallet {
  /** The per-wallet database id (`walletStore.loggedWallet.id`). */
  readonly walletId: number;
  /** The wallet's Cardano network as a vault network; undefined for any other. */
  readonly network: VaultNetwork | undefined;
}

export const GEROVAULT_WALLET: InjectionKey<() => GerovaultWallet | undefined> = Symbol('gerovault.wallet');

function loggedWallet(): GerovaultWallet | undefined {
  const wallet = walletStore.loggedWallet as { id?: unknown; network?: unknown } | null;
  if (!wallet || typeof wallet.id !== 'number' || !Number.isSafeInteger(wallet.id)) return undefined;
  return { walletId: wallet.id, network: vaultNetworkOf(wallet.network) };
}

/** A getter, so a computed that calls it follows a wallet switch. */
export function useGerovaultWallet(): () => GerovaultWallet | undefined {
  return inject(GEROVAULT_WALLET, null) ?? loggedWallet;
}

// -------------------------------------------------------------------------------------------------
// The chain reader

/** The reader for one vault network, or undefined when none is available. */
export type VaultChainReaderFactory = (network: VaultNetwork) => VaultChainReader | undefined;

export const GEROVAULT_CHAIN_READER: InjectionKey<VaultChainReaderFactory> = Symbol('gerovault.chainReader');

const readers = new Map<VaultNetwork, VaultChainReader>();

/** The wallet's own reader (`chain/vaultChainReader.ts`), one per network; undefined if it cannot be built. */
export const walletChainReader: VaultChainReaderFactory = network => {
  let reader = readers.get(network);
  if (!reader) {
    try {
      reader = createVaultChainReader(network);
    } catch {
      return undefined;
    }
    readers.set(network, reader);
  }
  return reader;
};

export function useVaultChainReaderFactory(): VaultChainReaderFactory {
  return inject(GEROVAULT_CHAIN_READER, null) ?? walletChainReader;
}

// -------------------------------------------------------------------------------------------------
// The wallet's own role keys

export { RoleKeysError, unavailableRoleKeysSource } from './roleKeys';
export type { RoleKeysErrorCode, VaultRoleKeysSource } from './roleKeys';

export const GEROVAULT_ROLE_KEYS: InjectionKey<VaultRoleKeysSource> = Symbol('gerovault.roleKeys');

export function useVaultRoleKeysSource(): VaultRoleKeysSource {
  return inject(GEROVAULT_ROLE_KEYS, null) ?? unavailableRoleKeysSource;
}

// -------------------------------------------------------------------------------------------------
// The funding gate

export const GEROVAULT_FUNDING_VERIFIER: InjectionKey<FundingVerifier> = Symbol('gerovault.fundingVerifier');

export function useFundingVerifier(): FundingVerifier {
  return inject(GEROVAULT_FUNDING_VERIFIER, null) ?? noFundingVerifier;
}
