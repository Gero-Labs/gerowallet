/**
 * Whether the logged wallet can create a vault on this screen, and how it unlocks its vault keys.
 * The slice opens vaults on `SLICE_NETWORKS` only (preprod), from account #0 of a recovery-phrase,
 * PassKey or Google wallet (`canHoldVaultKeys`).
 */
import type { Wallet } from '@/models/types';
import { SLICE_NETWORKS, vaultNetworkOf } from '@/modules/gerovault/contracts';
import type { VaultNetwork } from '@/shared/gerovault';
import { canHoldVaultKeys } from './ownAccountKeyFlow';

/**
 * - `password`: the spending password, checked in the background.
 * - `passkey`: the PassKey, in this page.
 * - `session`: a Google wallet's unlocked session, in the background; nothing to type.
 */
export type KeySource = 'password' | 'passkey' | 'session';

export type CreateEligibility =
  | { readonly ok: true; readonly walletId: number; readonly network: VaultNetwork; readonly keySource: KeySource }
  | { readonly ok: false; readonly reason: 'NO_WALLET' | 'NETWORK_CLOSED' | 'WALLET_NOT_SUPPORTED' };

type EligibilityWallet = Pick<Wallet, 'id' | 'chain' | 'network' | 'type' | 'encryptionMethod' | 'accountIndex' | 'parentWalletId'>;

export function createEligibility(wallet: EligibilityWallet | null | undefined): CreateEligibility {
  if (!wallet || typeof wallet.id !== 'number') return { ok: false, reason: 'NO_WALLET' };
  if (!canHoldVaultKeys(wallet)) return { ok: false, reason: 'WALLET_NOT_SUPPORTED' };
  const network = vaultNetworkOf(wallet.network);
  if (!network || !SLICE_NETWORKS.includes(network)) return { ok: false, reason: 'NETWORK_CLOSED' };
  const keySource: KeySource = wallet.encryptionMethod === 'mpc' ? 'session' : wallet.encryptionMethod === 'prf' ? 'passkey' : 'password';
  return { ok: true, walletId: wallet.id, network, keySource };
}
