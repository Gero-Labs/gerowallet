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
import type { RoleKeys, VaultNetwork } from '@/shared/gerovault';
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

/** No reader until the slice's implementation is wired in: chain data then shows as unavailable. */
const noReader: VaultChainReaderFactory = () => undefined;

export function useVaultChainReaderFactory(): VaultChainReaderFactory {
  return inject(GEROVAULT_CHAIN_READER, null) ?? noReader;
}

// -------------------------------------------------------------------------------------------------
// The wallet's own role keys

/** Why the wallet's own role keys could not be read. */
export type RoleKeysErrorCode = 'UNAVAILABLE' | 'WRONG_PASSWORD' | 'LOCKED' | 'NOT_SUPPORTED';

export class RoleKeysError extends Error {
  readonly code: RoleKeysErrorCode;

  constructor(code: RoleKeysErrorCode, message: string) {
    super(message);
    this.name = 'RoleKeysError';
    this.code = code;
  }
}

/**
 * The logged-in wallet's own CIP-1854 role keys (`m/1854'/1815'/0'/0` and `.../2`): public keys,
 * but they derive every vault key the wallet will ever hold, so they stay on this device. The
 * recovery package needs them to check that the exporting or restoring seed is the participant's.
 */
export interface VaultRoleKeysSource {
  /** Whether `roleKeys` needs the spending password. */
  readonly needsSpendingPassword: boolean;
  /** Throws `RoleKeysError`. */
  roleKeys(request: { readonly walletId: number; readonly spendingPassword?: string }): Promise<RoleKeys>;
}

export const GEROVAULT_ROLE_KEYS: InjectionKey<VaultRoleKeysSource> = Symbol('gerovault.roleKeys');

/**
 * Nothing in the wallet derives CIP-1854 keys for a page yet: that needs a background message that
 * decrypts the root key. Until one exists, the recovery screens say so instead of guessing.
 */
export const unavailableRoleKeysSource: VaultRoleKeysSource = Object.freeze({
  needsSpendingPassword: false,
  roleKeys: async () => {
    throw new RoleKeysError('UNAVAILABLE', 'This build cannot read the wallet\'s vault keys');
  },
});

export function useVaultRoleKeysSource(): VaultRoleKeysSource {
  return inject(GEROVAULT_ROLE_KEYS, null) ?? unavailableRoleKeysSource;
}

// -------------------------------------------------------------------------------------------------
// The funding gate

export const GEROVAULT_FUNDING_VERIFIER: InjectionKey<FundingVerifier> = Symbol('gerovault.fundingVerifier');

export function useFundingVerifier(): FundingVerifier {
  return inject(GEROVAULT_FUNDING_VERIFIER, null) ?? noFundingVerifier;
}
