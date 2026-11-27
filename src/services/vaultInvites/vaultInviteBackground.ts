/**
 * The GeroVault invitation service of the service worker, with its real dependencies: gero-sync
 * through the notify client's signed transport, the private store, the wallets' root keys behind
 * their credentials, the wallets' backup flag and contacts, the vault store and the ADA Handle
 * resolver. `background.ts` registers the page requests (`vaultInviteHandlers.ts`), and the push
 * handler reaches it through `vaultInviteHooks` (bound here, so notifyPush imports none of this).
 *
 * The whole feature sits behind the GeroVault flag: with it off, a push is not opened (the generic
 * line shows) and no page can reach the requests (the routes are gated).
 */
import { getPrivate, getPrivateEntries, removePrivate, setPrivate } from '@/utils/privateStore';
import { readFeatureFlagMirror } from '@/shared/utils/featureFlagMirror';
import { Blockchain, type Wallet } from '@/models/types';
import { getRewardAddress } from '@/chrome/serialization';
import { getDb } from '@/db/wallet-db';
import { vaultStore } from '@/db/vaultStore';
import adaHandleApi from '@/api/ada-handle.api';
import type { VaultNetwork } from '@/shared/gerovault';
import { publishableInviteKey } from './deviceInviteKey';
import { createInviteApi, type InviteTransport } from './inviteApi';
import { openVaultKey, type VaultKeyDeps } from './inviteKeys';
import { createInviteRecords, type InviteKv } from './inviteRecords';
import { createInviteService, type InviteService } from './inviteService';
import { stakeCredentialOfAddress } from './resolveCosigner';
import { vaultInviteHooks } from './vaultInviteHooks';

export const privateInviteKv: InviteKv = {
  get: async <T>(key: string) => (await getPrivate<T>(key)) ?? undefined,
  set: (key, value) => setPrivate(key, value),
  remove: key => removePrivate(key),
  entries: prefix => getPrivateEntries(prefix),
};

/** The invite records in the private store (the device key is read from here for `PUT /device`). */
export const inviteRecords = createInviteRecords(privateInviteKv);

/** Vault invitations are available in this worker: the GeroVault flag, as the push handler reads it. */
async function vaultInvitesAvailable(): Promise<boolean> {
  if (import.meta.env['VITE_GEROVAULT_FORCE_ON'] === 'true') return true;
  return (await readFeatureFlagMirror())['isVaultsEnabled'] === true;
}

/**
 * This device's invite public key for `PUT /device` (hex), made here when the device has none and
 * vault invitations are available: the notify registration publishes it at worker start and on
 * every re-assertion, so a wallet that never opened Create vault can still be invited.
 */
export function registrationInviteKey(log?: (message: string) => void): Promise<string | null> {
  return publishableInviteKey(inviteRecords, {
    available: vaultInvitesAvailable,
    random: n => globalThis.crypto.getRandomValues(new Uint8Array(n)),
    now: () => Date.now(),
    ...(log ? { log } : {}),
  });
}

function walletVaultNetwork(wallet: Pick<Wallet, 'network'>): VaultNetwork | null {
  const n = String(wallet.network ?? '').toLowerCase();
  return n === 'mainnet' || n === 'preprod' || n === 'preview' ? n : null;
}

/** The key-based stake credential of a Cardano HD wallet, from its account key. Never throws. */
export function walletStakeCredential(wallet: Wallet): string | null {
  const network = walletVaultNetwork(wallet);
  if (wallet.chain !== Blockchain.CARDANO || !wallet.publicKey || !network) return null;
  try {
    const read = stakeCredentialOfAddress(getRewardAddress(wallet.publicKey, wallet.chain, wallet.network).toBech32(), network);
    return read.ok ? read.credential : null;
  } catch {
    return null;
  }
}

export interface VaultInviteBackgroundDeps {
  readonly transport: InviteTransport;
  readonly keys: () => Promise<VaultKeyDeps>;
  /** Publish a new device invite key (`PUT /device`). */
  readonly publishDevice: () => void;
  readonly log: (message: string) => void;
}

/** Built once, on the first request or push, so a worker start does not open the stores. */
export function createVaultInviteBackground(deps: VaultInviteBackgroundDeps): () => Promise<InviteService> {
  let service: InviteService | null = null;

  // Static imports only: a dynamic import inside the worker's single bundle can be read before it
  // exists (scripts/check-bundle-tdz.mjs). The wallet list comes from the same dependency as the keys.
  const allWallets = async (): Promise<Record<number, Wallet>> => ((await (await deps.keys()).getWallets()) ?? {});

  function build(): InviteService {
    return createInviteService({
      api: createInviteApi(deps.transport),
      records: inviteRecords,
      keys: { open: async (walletId, auth, index) => openVaultKey(walletId, auth, index, await deps.keys()) },
      wallets: {
        all: allWallets,
        stakeCredential: walletStakeCredential,
        async backedUp(walletId) {
          const db = await getDb(walletId);
          if (!db) return false;
          // No row: a wallet with no recovery phrase to back up (a Google MPC wallet).
          const row = await db.table('config').get('backup') as { value?: unknown } | undefined;
          return row === undefined || row.value === true;
        },
        async contactCredentials(network) {
          const out = new Set<string>();
          for (const wallet of Object.values(await allWallets())) {
            if (walletVaultNetwork(wallet) !== network) continue;
            const db = await getDb(wallet.id).catch(() => null);
            const contacts = (await db?.table('contacts').toArray().catch(() => [])) as { address?: unknown }[] | undefined;
            for (const c of contacts ?? []) {
              const read = typeof c.address === 'string' ? stakeCredentialOfAddress(c.address, network) : null;
              if (read?.ok) out.add(read.credential);
            }
          }
          return out;
        },
      },
      vaultIndexes: walletId => vaultStore.list(walletId),
      async resolveHandle(handle) {
        try {
          const res = await adaHandleApi.resolve(handle);
          const address = (res?.data as { resolved_addresses?: { ada?: unknown } } | undefined)?.resolved_addresses?.ada;
          return typeof address === 'string' ? address : null;
        } catch (error) {
          if ((error as { response?: { status?: number } })?.response?.status === 404) return null;
          throw error;
        }
      },
      random: n => globalThis.crypto.getRandomValues(new Uint8Array(n)),
      now: () => Date.now(),
      onDeviceKeyCreated: deps.publishDevice,
      log: deps.log,
    });
  }

  const get = async (): Promise<InviteService> => {
    service ??= build();
    return service;
  };

  vaultInviteHooks.forPush = async (t, setupId) => {
    if (!(await vaultInvitesAvailable())) return null;
    return (await get()).forPush(t, setupId);
  };
  return get;
}
