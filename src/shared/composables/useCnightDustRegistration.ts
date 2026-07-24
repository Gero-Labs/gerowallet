/**
 * cNIGHT → DUST registration (Path B — Cardano-side mapping validator).
 *
 * Registers the logged CARDANO wallet's stake credential with Midnight's
 * `cnight_generates_dust` mapping validator so the NIGHT it holds on Cardano
 * generates DUST to the wallet's own Midnight DUST address. Mirrors the
 * official DUST Generator portal (midnight-dust-mainnet.nethermind.io) but
 * with Gero's structural advantage: the Cardano keys and the Midnight DUST
 * address derive from the same mnemonic, so there is no wallet-connect step
 * and no address copy-paste.
 *
 * Flow (single password / PassKey gesture):
 *   1. Decrypt the mnemonic (password or PRF) and derive the wallet's own
 *      Midnight DUST address (`deriveMidnightAddresses`, same as the
 *      DustRegistrationDialog legacy-upgrade path).
 *   2. Nexus builds the mapping-validator tx (`dust/build-registration-tx`)
 *      — datum keyed to the STAKE credential, requiredSigners = payment +
 *      stake key hashes (nexus PR #687).
 *   3. Standard SIGN_TX (the resolver auto-includes the stake witness via
 *      requiredSigners matching) + SUBMIT_TX — same pipeline as Strike's
 *      backend-built CBOR flow.
 *
 * Status reads use Nexus `dust/status?cardanoRewardAddress=` which proxies
 * the Midnight indexer's `dustGenerationStatus(cardanoRewardAddresses)`.
 */

import { computed, ref, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import { Blockchain, Network, Wallet } from '@/models/types';
import {
  DustAlreadyRegisteredError,
  DustRegistrationUtxoDto,
  getMidnightApi,
  MidnightDustRegistrationStatusDto,
} from '@/api/midnight-api';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { clearDustPending, getDustPending, markDustPending, reconcileDustPending, DustPendingRecord } from '@/shared/composables/useDustPending';
import { isCollateralError } from '@/shared/utils/txErrors';
import { debugLog } from '@/utils/debug';

/** A place DUST from this wallet's NIGHT can be directed. */
export interface DustDestination {
  /** 'self' = this Cardano wallet's own same-seed Midnight address (derived at
   *  register time); otherwise an imported Midnight wallet's id. */
  key: string;
  label: string;
  /** Known bech32m DUST address; empty for 'self' until derived. */
  dustAddress: string;
}

/**
 * cNIGHT asset identity per Cardano network. Values verified 2026-07-14 from
 * the official DUST Generator portal's baked config (Next.js bundle) —
 * mainnet name is `NIGHT` (`4e49474854`); the testnet asset has an empty
 * asset name. Preview and preprod share one policy (same token deployment).
 */
export const CNIGHT_ASSETS: Record<string, { policyId: string; assetNameHex: string }> = {
  [Network.MAINNET]: {
    policyId: '0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa',
    assetNameHex: '4e49474854',
  },
  [Network.PREPROD]: {
    policyId: 'd2dbff622e509dda256fedbd31ef6e9fd98ed49ad91d5c0e07f68af1',
    assetNameHex: '',
  },
  [Network.PREVIEW]: {
    policyId: 'd2dbff622e509dda256fedbd31ef6e9fd98ed49ad91d5c0e07f68af1',
    assetNameHex: '',
  },
};

/**
 * DUST mapping validator (`cnight_generates_dust`) per Cardano network — the
 * script a cNIGHT→DUST registration locks its mapping NFT under. Used to detect
 * and deep-link a registration transaction. Script hashes portal-verified
 * 2026-07-14; addresses derived from them (type-7 enterprise script address).
 * Preview and preprod share one deployment.
 */
export const DUST_MAPPING_VALIDATOR: Record<string, { scriptHash: string; address: string }> = {
  [Network.MAINNET]: {
    scriptHash: '73e4aea31b5b51d9b0ca386196fc6a4c422f74c5aea011e4b8bdf4e5',
    address: 'addr1w9e7ft4rrdd4rkdseguxr9hudfxyytm5ckh2qy0yhz7lfeg9lvhq7',
  },
  [Network.PREPROD]: {
    scriptHash: '7e69087d98fac5869eac14e13dfb6f98228c41e638aa2a59d1f85e9c',
    address: 'addr_test1wplxjzranravtp574s2wz00md7vz9rzpucu252je68u9a8qzjheng',
  },
  [Network.PREVIEW]: {
    scriptHash: '7e69087d98fac5869eac14e13dfb6f98228c41e638aa2a59d1f85e9c',
    address: 'addr_test1wplxjzranravtp574s2wz00md7vz9rzpucu252je68u9a8qzjheng',
  },
};

/**
 * Map a raw Nexus build error to a stable code the dialogs can localize. The
 * DUST registration is a Plutus tx, so Nexus needs a pure-ADA collateral UTxO;
 * a wallet whose ADA is all bundled with native tokens gets a bare 400 that
 * reads as a dead end. Surface it as NO_COLLATERAL so the UI explains the fix
 * (send ~6 ADA to yourself to mint a clean collateral UTxO) instead of echoing
 * the raw server string.
 */
export function mapDustBuildError(message: string): string {
  return isCollateralError(message) ? 'NO_COLLATERAL' : message;
}

/**
 * Official portal URLs — fallback CTA when the wallet can't sign locally
 * (hardware wallets). No preprod instance exists (probed 2026-07-14:
 * midnight-dust-preprod.nethermind.io unreachable, and the preview portal is
 * network-wired to preview) — on preprod this wallet flow is the only UI, so
 * the portal CTA is hidden there.
 */
export const DUST_PORTAL_URLS: Record<string, string> = {
  [Network.MAINNET]: 'https://midnight-dust-mainnet.nethermind.io/',
  [Network.PREVIEW]: 'https://dust.preview.midnight.network/',
};

/**
 * localStorage record of which wallets have dismissed the inline DUST generation
 * line. Keyed PER WALLET (stake address) so hiding it on one wallet never
 * suppresses the DUST opportunity on another wallet that also holds NIGHT. The
 * table row + token drawer share this dismissal for a given wallet. Value is a
 * JSON array of stake addresses; the legacy global `'1'` value is ignored (not
 * an array), so old dismissals cleanly re-surface as per-wallet going forward.
 */
export const DUST_LINE_DISMISS_KEY = 'gero.dustLine.dismissed';

function readDismissedStakes(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(DUST_LINE_DISMISS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Whether this wallet dismissed the DUST line. */
export function isDustLineDismissed(stakeAddress: string | undefined | null): boolean {
  return !!stakeAddress && readDismissedStakes().includes(stakeAddress);
}

/** Dismiss the DUST line for this wallet only. */
export function dismissDustLineFor(stakeAddress: string | undefined | null): void {
  if (!stakeAddress || typeof localStorage === 'undefined') return;
  const set = readDismissedStakes();
  if (!set.includes(stakeAddress)) {
    set.push(stakeAddress);
    localStorage.setItem(DUST_LINE_DISMISS_KEY, JSON.stringify(set));
  }
}

export type CnightRegistrationStage =
  | 'idle'
  | 'deriving'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'done';

export type CnightRegistrationResult =
  | { status: 'submitted'; txHash: string; dustAddress: string }
  /** A live registration already exists server-side (409 `already_registered`).
   *  `registrations` on the composable has already been updated — the caller
   *  should just close/reset and let `registrationStatus` re-derive as
   *  Pending/Duplicated instead of showing an error. */
  | { status: 'already_registered' }
  | { status: 'error'; message: string };

interface RegisterCredentials {
  /** Spending password (password wallets). */
  password?: string;
  /** Pre-evaluated PRF output from `evaluatePrfForWallet` (PassKey wallets). */
  prfOutput?: ArrayBuffer;
}

/**
 * Session-level tombstone for registration UTxOs we've just deregistered.
 * `dust/registrations` reads confirmed chain state, so a just-submitted
 * deregistration can still list its spent outpoint for ~20-90s until the tx
 * clears the mempool — without this, `refreshStatus()` would immediately
 * overwrite the optimistic local filter and the just-removed row would
 * reappear clickable, letting a second click build a tx spending an
 * already-spent UTxO. Module-level (not composable-level) so it survives the
 * dialog component being unmounted/remounted between the removal and the
 * next refresh. Self-clears the normal way: once an outpoint drops out of the
 * server's live list on its own, its tombstone entry is deleted too (see
 * `refreshRegistrations`).
 *
 * Value is the tombstone's added-at timestamp (ms) rather than a bare
 * membership flag, because a *successful submit* doesn't guarantee on-chain
 * inclusion — the tx can still be evicted from the mempool or dropped by a
 * rollback under congestion. Without an expiry, a dropped removal would
 * latch the outpoint out of `registrations` for the rest of the extension
 * session: the user would see a false 'Pending'/lower count while on-chain
 * reality is still Duplicated, with no way to see or fix it short of a
 * restart. TTL is 12 minutes — ~10x the normal 20-90s mempool window — so a
 * healthy removal never expires prematurely, but a genuinely dropped one
 * resurfaces the row within a bounded window. Letting it expire is safe: if
 * the row honestly reappears and the user retries, two competing spends of
 * the same UTxO can't both land — the loser just fails harmlessly.
 */
const removedOutpoints = new Map<string, number>();
const REMOVED_OUTPOINT_TTL_MS = 12 * 60 * 1000;

function outpointKey(txHash: string, outputIndex: number): string {
  return `${txHash}#${outputIndex}`;
}

/** True while `key`'s tombstone is still within its TTL; lazily deletes (and
 *  reports false for) an expired entry so it stops suppressing the row. */
function isOutpointTombstoned(key: string): boolean {
  const addedAt = removedOutpoints.get(key);
  if (addedAt === undefined) return false;
  if (Date.now() - addedAt > REMOVED_OUTPOINT_TTL_MS) {
    removedOutpoints.delete(key);
    return false;
  }
  return true;
}

export function useCnightDustRegistration() {
  const { loggedWallet, tokens, keys, utxos } = toRefs(walletStore);

  const status = ref<MidnightDustRegistrationStatusDto | null>(null);
  const statusLoading = ref(false);
  const registering = ref(false);
  const stage = ref<CnightRegistrationStage>('idle');

  const network = computed<string>(() => loggedWallet.value?.network ?? '');

  /** Feature gate: Cardano software wallet on a network Midnight anchors on. */
  const isSupported = computed(() => {
    if (loggedWallet.value?.chain !== Blockchain.CARDANO) return false;
    return !!CNIGHT_ASSETS[network.value];
  });

  /** Hardware wallets hold no mnemonic — they register via the official portal instead. */
  const canSignLocally = computed(() => {
    const w = loggedWallet.value;
    if (!w) return false;
    return !!(w.encryptedMnemonic || w.prfEncryptedMnemonic);
  });

  const cnightUnit = computed(() => {
    const asset = CNIGHT_ASSETS[network.value];
    return asset ? asset.policyId + asset.assetNameHex : '';
  });

  /** Raw cNIGHT quantity (base units) held by the logged wallet. */
  const cnightBalance = computed<bigint>(() => {
    if (!cnightUnit.value) return 0n;
    const token = tokens.value?.[cnightUnit.value];
    if (!token?.quantity) return 0n;
    try {
      return BigInt(token.quantity);
    } catch {
      return 0n;
    }
  });

  const cnightDecimals = computed<number>(() => {
    const token = tokens.value?.[cnightUnit.value];
    return token?.metadata?.decimals ?? 6;
  });

  // Locally-tracked pending registration (indexer lags ~2.5h). Bumped on
  // refresh/register so the computed below reacts.
  const localPending = ref<DustPendingRecord | null>(null);

  // Live registration UTxOs for this stake credential (Nexus `dust/registrations`).
  // Midnight allows exactly ONE live registration per stake credential — more
  // than one invalidates the whole set. This is the source of truth for
  // duplicate detection; `status` alone can't distinguish "unregistered" from
  // "invalidated by a duplicate" (both read `registered:false`).
  const registrations = ref<DustRegistrationUtxoDto[]>([]);

  // Best-effort cache of THIS wallet's own derived DUST address hex. Deriving
  // it requires the decrypted mnemonic (a password/PassKey gesture), so it's
  // only known once `register()` or `migrateDustAddressToOwn()` has actually
  // run in this session — never prompted for proactively just to label a row.
  const ownDustAddressHex = ref<string>('');

  /** The registration that is THIS wallet's own (matched by derived DUST
   *  address when known); falls back to the first registration in list order. */
  const primaryRegistration = computed<DustRegistrationUtxoDto | null>(() => {
    if (registrations.value.length === 0) return null;
    if (ownDustAddressHex.value) {
      const match = registrations.value.find(
        (r) => r.dustAddressHex.toLowerCase() === ownDustAddressHex.value.toLowerCase(),
      );
      if (match) return match;
    }
    return registrations.value[0];
  });

  /** Every live registration that is NOT the primary — candidates for removal. */
  const replicates = computed<DustRegistrationUtxoDto[]>(() => {
    const primary = primaryRegistration.value;
    if (!primary) return [];
    return registrations.value.filter(
      (r) => !(r.txHash === primary.txHash && r.outputIndex === primary.outputIndex),
    );
  });

  const registrationStatus = computed<'Unregistered' | 'Pending' | 'Registered' | 'Invalid' | 'Duplicated' | 'Unknown'>(() => {
    // Duplicated wins over every other signal (including the local pending
    // guard and a stale 'Registered' status field): the protocol invalidates
    // the whole set the moment a second live registration UTxO exists, and
    // the Register CTA must stay hidden until it's back down to one.
    if (registrations.value.length > 1) return 'Duplicated';

    const s = status.value?.registrationStatus;
    if (s === 'Registered') return 'Registered';

    // Exactly one live registration UTxO: the mapping is valid even if the
    // indexer hasn't relayed `registered:true` yet (~2.5h window) or the
    // registration was made outside Gero (e.g. the official portal, which
    // never leaves a local pending record) — never offer Register while a
    // live registration exists.
    if (registrations.value.length === 1) return 'Pending';

    if (s === 'Invalid') return 'Invalid';
    if (s === 'Pending') return 'Pending';
    // Indexer still says Unregistered (or unknown) but we submitted a
    // registration that hasn't relayed yet — hold Pending so the UI can't
    // offer a duplicate registration.
    if (localPending.value) return 'Pending';
    if (statusLoading.value && !status.value) return 'Unknown';
    if (status.value) return 'Unregistered';
    return 'Unknown';
  });

  /** Empty string when no portal exists for this network (preprod) — callers hide the CTA. */
  const portalUrl = computed(() => DUST_PORTAL_URLS[network.value] ?? '');

  // ── DUST destination selection ──────────────────────────────────────────────
  // Default: this Cardano wallet's own same-seed Midnight address. But the user
  // may instead direct DUST to a DIFFERENT Midnight wallet already imported in
  // the extension (e.g. their main Midnight wallet on a different seed).

  /** Imported Midnight wallets on this network, with their DUST address read
   *  from the record (`publicKey` = JSON {unshielded, shielded, dust}). */
  const midnightDestinations = computed<DustDestination[]>(() => {
    const records = Object.values(geroStore.wallets ?? {}) as Array<Wallet & { publicKey?: string }>;
    const out: DustDestination[] = [];
    for (const w of records) {
      if (w.chain !== Blockchain.MIDNIGHT || w.network !== network.value) continue;
      let dust = '';
      try {
        dust = w.publicKey ? (JSON.parse(w.publicKey)?.dust ?? '') : '';
      } catch {
        dust = '';
      }
      if (dust) out.push({ key: `wallet:${w.id}`, label: w.name, dustAddress: dust });
    }
    return out;
  });

  /** All destination options, 'self' first. */
  const destinationOptions = computed<DustDestination[]>(() => [
    { key: 'self', label: loggedWallet.value?.name ?? 'This wallet', dustAddress: '' },
    ...midnightDestinations.value,
  ]);

  /** Selected destination key; 'self' = same-seed derive at register time. */
  const selectedDestinationKey = ref<string>('self');

  /**
   * Refresh the live registrations list. Resilient to failure (e.g. an older
   * Nexus deployment that doesn't have this endpoint yet, or a transient
   * network error): keeps the previous list rather than resetting to empty,
   * so a blip can't regress a known Duplicated state back to Unregistered.
   */
  async function refreshRegistrations(stakeAddress: string): Promise<void> {
    try {
      const fetched = await getMidnightApi(network.value).getDustRegistrations(stakeAddress);
      // Self-heal: once the server confirms an outpoint is actually gone
      // (the deregistration tx cleared the mempool), drop its tombstone. TTL
      // expiry (below, via `isOutpointTombstoned`) covers the drop/rollback
      // case where the server never stops reporting the outpoint.
      for (const key of [...removedOutpoints.keys()]) {
        if (!fetched.some((r) => outpointKey(r.txHash, r.outputIndex) === key)) {
          removedOutpoints.delete(key);
        }
      }
      // Filter tombstoned (and not-yet-expired) outpoints out BEFORE
      // assigning, so a mempool-lagged server response can't resurrect a row
      // we just removed.
      registrations.value = fetched.filter((r) => !isOutpointTombstoned(outpointKey(r.txHash, r.outputIndex)));
    } catch (e) {
      // Reviewed residual: if consolidation happened in ANOTHER session (or
      // via the official portal) and every fetch in THIS session keeps
      // failing, we'd keep showing a stale Duplicated state past the point
      // it's actually resolved. Accepted because (a) any single successful
      // refresh self-heals immediately, and (b) in-wallet removals already
      // filter the local list optimistically in `deregisterOutpoint()`, so
      // the stale case only bites a read-only view in a persistently broken
      // network state, not an action the user takes here.
      debugLog('[cNIGHT DUST] registrations fetch failed:', e instanceof Error ? e.message : String(e));
    }
  }

  async function refreshStatus(): Promise<void> {
    const stakeAddress = loggedWallet.value?.stakeAddress;
    if (!isSupported.value || !stakeAddress) return;
    statusLoading.value = true;
    try {
      status.value = await getMidnightApi(network.value).getDustStatus(stakeAddress);
      await refreshRegistrations(stakeAddress);
      // Reconcile the local pending guard: clear it once the indexer confirms
      // Registered (and there's at most one live registration — a stale
      // 'Registered' alongside a known duplicate shouldn't clear the guard);
      // otherwise surface any un-expired local record.
      if (status.value?.registrationStatus === 'Registered' && registrations.value.length <= 1) {
        clearDustPending(stakeAddress);
        localPending.value = null;
      } else {
        // Not (cleanly) Registered: reconcile the local guard against the
        // chain so a submission that never landed can't block re-registration
        // for 24h.
        localPending.value = await reconcileDustPending(
          stakeAddress,
          (txHash) => getMidnightApi(network.value).cardanoTxExists(txHash),
        );
      }
    } catch (e) {
      // 404 = the indexer knows nothing about this reward address yet — plain
      // unregistered. Other failures leave status null (renders as Unknown).
      const msg = e instanceof Error ? e.message : String(e);
      debugLog('[cNIGHT DUST] status fetch failed:', msg);
      status.value = {
        cardanoRewardAddress: stakeAddress,
        dustAddress: null,
        registered: false,
        registrationStatus: 'Unregistered',
      };
      await refreshRegistrations(stakeAddress);
      localPending.value = getDustPending(stakeAddress);
    } finally {
      statusLoading.value = false;
    }
  }

  /**
   * Decrypt the mnemonic with the supplied credentials. Wrong password
   * surfaces as a typed error (decrypt throws on MAC failure).
   */
  async function decryptMnemonic(credentials: RegisterCredentials): Promise<string> {
    const wallet = loggedWallet.value;
    if (!wallet) throw new Error('No wallet logged in');

    if (credentials.prfOutput) {
      if (!wallet.prfEncryptedMnemonic || !wallet.webAuthnCredentialId) {
        throw new Error('PRF wallet is missing its encrypted mnemonic. Re-restore from your seed phrase.');
      }
      const { decryptMnemonicWithPrfOutput } = await import('@/shared/utils/webauthn-prf');
      return decryptMnemonicWithPrfOutput(
        wallet.prfEncryptedMnemonic,
        credentials.prfOutput,
        wallet.webAuthnCredentialId,
        wallet.id.toString(),
      );
    }

    if (!wallet.encryptedMnemonic) {
      throw new Error('Wallet has no encrypted mnemonic. Hardware wallets register via the official portal.');
    }
    const { decrypt } = await import('@/shared/utils/crypto');
    try {
      return decrypt(wallet.encryptedMnemonic, credentials.password ?? '');
    } catch {
      throw new Error('WRONG_PASSWORD');
    }
  }

  /**
   * End-to-end registration: derive DUST address → Nexus build → sign → submit.
   * One password/PassKey gesture; PRF wallets sign with the root key derived
   * from the just-decrypted mnemonic (no second WebAuthn ceremony).
   */
  async function register(credentials: RegisterCredentials): Promise<CnightRegistrationResult> {
    const wallet = loggedWallet.value;
    if (!wallet?.baseAddress || !wallet?.stakeAddress) {
      return { status: 'error', message: 'Wallet is missing its Cardano addresses' };
    }
    const paymentKeyHashHex: string | undefined = keys.value?.payment?.[0]?.cred;

    registering.value = true;
    stage.value = 'deriving';
    try {
      const mnemonic = await decryptMnemonic(credentials);

      const { deriveMidnightAddresses, dustAddressToHex } = await import('@/chains/midnight/midnightKeyManager');
      // Destination: a chosen imported Midnight wallet, or (default) this
      // Cardano wallet's own same-seed Midnight DUST address.
      const chosen = destinationOptions.value.find((d) => d.key === selectedDestinationKey.value);
      const usingSelfDestination = !chosen || chosen.key === 'self' || !chosen.dustAddress;
      const destinationBech32 = chosen && chosen.key !== 'self' && chosen.dustAddress
        ? chosen.dustAddress
        : (await deriveMidnightAddresses(mnemonic, wallet.network)).dust;
      const dustAddressHex = dustAddressToHex(destinationBech32);
      // Cache this wallet's own derived DUST address hex — the only reliable
      // way to identify "primary" in a Duplicated state without a fresh
      // credentialed derivation (see `primaryRegistration`).
      if (usingSelfDestination) ownDustAddressHex.value = dustAddressHex;

      stage.value = 'building';
      const build = await getMidnightApi(network.value).buildDustRegistrationTx({
        cardanoAddress: wallet.baseAddress,
        paymentKeyHashHex: paymentKeyHashHex ?? '',
        dustAddressHex,
      });
      if (build.status !== 'complete' || !build.txCbor) {
        throw new Error(build.note || 'Nexus did not return a complete registration transaction');
      }

      stage.value = 'signing';
      const txId = await signAndSubmit(build.txCbor, credentials, mnemonic);

      stage.value = 'done';
      // Persist the pending registration so a reopen (before the ~2.5h relay)
      // shows Pending and cannot submit a duplicate.
      markDustPending(wallet.stakeAddress, destinationBech32, txId);
      localPending.value = getDustPending(wallet.stakeAddress);
      // Optimistic status flip — the indexer takes ~2.5h to relay, so reflect
      // Pending immediately rather than waiting for the next poll.
      status.value = {
        cardanoRewardAddress: wallet.stakeAddress,
        dustAddress: destinationBech32,
        registered: false,
        registrationStatus: 'Pending',
        registrationUtxoTxHash: txId,
      };
      return { status: 'submitted', txHash: txId, dustAddress: destinationBech32 };
    } catch (e) {
      if (e instanceof DustAlreadyRegisteredError) {
        // Nexus refused: a live registration already exists. Adopt the
        // server's list so `registrationStatus` re-derives as Pending (one)
        // or Duplicated (more than one) instead of the caller showing a raw
        // error toast. Filter against the (TTL-aware) tombstone too — the
        // same mempool lag that affects `refreshRegistrations()` can affect
        // this list.
        registrations.value = e.registrations.filter(
          (r) => !isOutpointTombstoned(outpointKey(r.txHash, r.outputIndex)),
        );
        return { status: 'already_registered' };
      }
      const message = mapDustBuildError(e instanceof Error ? e.message : String(e));
      return { status: 'error', message };
    } finally {
      registering.value = false;
      if (stage.value !== 'done') stage.value = 'idle';
    }
  }

  /**
   * Sign the Nexus-built CBOR (payment + stake witnesses via the standard
   * SIGN_TX resolver — requiredSigners carries both key hashes) and submit
   * through the normal Cardano submit flow. Returns the tx id.
   *
   * PRF wallets reuse the single PRF evaluation to decrypt the root-key blob
   * (the exact byte format the SIGN_TX passkey path consumes); wallets
   * restored before the prfEncryptedPrivateKey blob existed fall back to
   * deriving the root key from the decrypted mnemonic.
   */
  async function signAndSubmit(
    txCbor: string,
    credentials: RegisterCredentials,
    mnemonic?: string,
  ): Promise<string> {
    const wallet = loggedWallet.value;
    if (!wallet) throw new Error('No wallet logged in');

    const signingData: Record<string, unknown> = {
      txCbor,
      partialSign: false,
      accountIndex: 0,
      utxos: utxos.value,
      addresses: keys.value,
      mergeWitnesses: false,
    };
    if (credentials.prfOutput) {
      if (wallet.prfEncryptedPrivateKey && wallet.webAuthnCredentialId) {
        const { decryptPrivateKeyWithPrf } = await import('@/shared/utils/webauthn-prf');
        const pkBytes = await decryptPrivateKeyWithPrf(
          wallet.prfEncryptedPrivateKey,
          wallet.webAuthnCredentialId,
          wallet.id.toString(),
          credentials.prfOutput,
        );
        signingData.privateKeyBytes = Array.from(pkBytes);
      } else {
        const seed = mnemonic ?? await decryptMnemonic(credentials);
        const { resolvePrivateKey } = await import('@/shared/utils/resolver');
        const rootKeyHex = resolvePrivateKey(seed).hex();
        signingData.privateKeyBytes = Array.from(Buffer.from(rootKeyHex, 'hex'));
      }
    } else {
      signingData.password = credentials.password;
    }

    const signResponse = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: signingData,
    }) as { data: { witnesses?: string; error?: string } };
    if (!signResponse?.data?.witnesses) {
      throw new Error(signResponse?.data?.error || 'Transaction signing failed');
    }

    stage.value = 'submitting';
    // Merge witnesses locally (body-hash guard) and submit through NEXUS —
    // never Blockfrost/Koios. Nexus surfaces the node's real ledger error.
    const [{ Serialization }, { HexBlob }] = await Promise.all([
      import('@cardano-sdk/core'),
      import('@cardano-sdk/util'),
    ]);
    const tx = Serialization.Transaction.fromCbor(HexBlob(txCbor));
    const bodyHashBefore = tx.body().hash();
    const witnessSet = tx.witnessSet();
    const incoming = Serialization.TransactionWitnessSet.fromCbor(HexBlob(signResponse.data.witnesses)).toCore();
    const merged = new Map([
      ...(witnessSet.toCore().signatures?.entries() ?? []),
      ...incoming.signatures.entries(),
    ]);
    witnessSet.setVkeys(Serialization.CborSet.fromCore([...merged.entries()], Serialization.VkeyWitness.fromCore));
    tx.setWitnessSet(witnessSet);
    if (tx.body().hash() !== bodyHashBefore) {
      throw new Error('Transaction body changed while applying witnesses; refusing to submit');
    }
    return getMidnightApi(network.value).submitCardanoTx(tx.toCbor());
  }

  /** The registration UTxO outpoint required by the deregister/update builders. */
  function registrationOutpoint(): { txHash: string; outputIndex: number } {
    const txHash = status.value?.registrationUtxoTxHash;
    const outputIndex = status.value?.registrationUtxoOutputIndex;
    if (!txHash || outputIndex === null || outputIndex === undefined) {
      throw new Error('Registration UTxO not known yet. Refresh the status and try again.');
    }
    return { txHash, outputIndex };
  }

  /**
   * Deregister: spend the registration UTxO + burn the mapping NFT. The
   * accumulated DUST decays to zero after relay. No mnemonic needed on the
   * password path (SIGN_TX decrypts the stored key itself).
   */
  async function deregister(credentials: RegisterCredentials): Promise<CnightRegistrationResult> {
    const wallet = loggedWallet.value;
    if (!wallet?.baseAddress || !wallet?.stakeAddress) {
      return { status: 'error', message: 'Wallet is missing its Cardano addresses' };
    }
    registering.value = true;
    stage.value = 'building';
    try {
      const outpoint = registrationOutpoint();
      const build = await getMidnightApi(network.value).buildDustDeregistrationTx({
        cardanoAddress: wallet.baseAddress,
        paymentKeyHashHex: keys.value?.payment?.[0]?.cred,
        registrationUtxoTxHash: outpoint.txHash,
        registrationUtxoOutputIndex: outpoint.outputIndex,
      });
      if (build.status !== 'complete' || !build.txCbor) {
        throw new Error(build.note || 'Nexus did not return a complete deregistration transaction');
      }

      stage.value = 'signing';
      const txId = await signAndSubmit(build.txCbor, credentials);

      stage.value = 'done';
      clearDustPending(wallet.stakeAddress);
      localPending.value = null;
      status.value = {
        cardanoRewardAddress: wallet.stakeAddress,
        dustAddress: null,
        registered: false,
        registrationStatus: 'Unregistered',
      };
      return { status: 'submitted', txHash: txId, dustAddress: '' };
    } catch (e) {
      return { status: 'error', message: mapDustBuildError(e instanceof Error ? e.message : String(e)) };
    } finally {
      registering.value = false;
      if (stage.value !== 'done') stage.value = 'idle';
    }
  }

  /**
   * Deregister a SPECIFIC registration UTxO by outpoint — the parameterized
   * variant of `deregister()` the Duplicated-state consolidation panel uses to
   * remove a non-primary replicate. Same build/sign/submit path; the caller
   * supplies the outpoint directly instead of relying on `registrationOutpoint()`
   * (which reads the single indexer-reported outpoint — null/ambiguous once
   * more than one registration exists).
   */
  async function deregisterOutpoint(
    credentials: RegisterCredentials,
    txHash: string,
    outputIndex: number,
  ): Promise<CnightRegistrationResult> {
    const wallet = loggedWallet.value;
    if (!wallet?.baseAddress || !wallet?.stakeAddress) {
      return { status: 'error', message: 'Wallet is missing its Cardano addresses' };
    }
    registering.value = true;
    stage.value = 'building';
    try {
      const build = await getMidnightApi(network.value).buildDustDeregistrationTx({
        cardanoAddress: wallet.baseAddress,
        paymentKeyHashHex: keys.value?.payment?.[0]?.cred,
        registrationUtxoTxHash: txHash,
        registrationUtxoOutputIndex: outputIndex,
      });
      if (build.status !== 'complete' || !build.txCbor) {
        throw new Error(build.note || 'Nexus did not return a complete deregistration transaction');
      }

      stage.value = 'signing';
      const txId = await signAndSubmit(build.txCbor, credentials);

      stage.value = 'done';
      // Tombstone the outpoint (with a TTL) so a mempool-lagged
      // `refreshStatus()` call right after this can't resurrect it — see
      // `removedOutpoints` above for why it expires rather than latching.
      removedOutpoints.set(outpointKey(txHash, outputIndex), Date.now());
      // Drop the removed outpoint locally so the panel updates immediately;
      // the caller still re-runs refreshStatus() to reconcile against the
      // indexer once the removal relays.
      registrations.value = registrations.value.filter(
        (r) => !(r.txHash === txHash && r.outputIndex === outputIndex),
      );
      if (registrations.value.length <= 1) {
        clearDustPending(wallet.stakeAddress);
        localPending.value = null;
      }
      return { status: 'submitted', txHash: txId, dustAddress: '' };
    } catch (e) {
      return { status: 'error', message: mapDustBuildError(e instanceof Error ? e.message : String(e)) };
    } finally {
      registering.value = false;
      if (stage.value !== 'done') stage.value = 'idle';
    }
  }

  /**
   * Point the existing registration at THIS wallet's own Midnight DUST address
   * (migration from a portal/Lace registration). One tx: spend + re-output
   * with the replacement datum.
   */
  async function migrateDustAddressToOwn(credentials: RegisterCredentials): Promise<CnightRegistrationResult> {
    const wallet = loggedWallet.value;
    if (!wallet?.baseAddress || !wallet?.stakeAddress) {
      return { status: 'error', message: 'Wallet is missing its Cardano addresses' };
    }
    registering.value = true;
    stage.value = 'deriving';
    try {
      const outpoint = registrationOutpoint();
      const mnemonic = await decryptMnemonic(credentials);
      const { deriveMidnightAddresses, dustAddressToHex } = await import('@/chains/midnight/midnightKeyManager');
      const derived = await deriveMidnightAddresses(mnemonic, wallet.network);
      const dustAddressHex = dustAddressToHex(derived.dust);
      // This flow always derives THIS wallet's own address — cache it for
      // primary-marking the same way `register()` does.
      ownDustAddressHex.value = dustAddressHex;

      stage.value = 'building';
      const build = await getMidnightApi(network.value).buildDustUpdateTx({
        cardanoAddress: wallet.baseAddress,
        paymentKeyHashHex: keys.value?.payment?.[0]?.cred,
        registrationUtxoTxHash: outpoint.txHash,
        registrationUtxoOutputIndex: outpoint.outputIndex,
        dustAddressHex,
      });
      if (build.status !== 'complete' || !build.txCbor) {
        throw new Error(build.note || 'Nexus did not return a complete update transaction');
      }

      stage.value = 'signing';
      const txId = await signAndSubmit(build.txCbor, credentials, mnemonic);

      stage.value = 'done';
      markDustPending(wallet.stakeAddress, derived.dust, txId);
      localPending.value = getDustPending(wallet.stakeAddress);
      status.value = {
        cardanoRewardAddress: wallet.stakeAddress,
        dustAddress: derived.dust,
        registered: false,
        registrationStatus: 'Pending',
        registrationUtxoTxHash: txId,
      };
      return { status: 'submitted', txHash: txId, dustAddress: derived.dust };
    } catch (e) {
      return { status: 'error', message: mapDustBuildError(e instanceof Error ? e.message : String(e)) };
    } finally {
      registering.value = false;
      if (stage.value !== 'done') stage.value = 'idle';
    }
  }

  return {
    isSupported,
    canSignLocally,
    cnightUnit,
    cnightBalance,
    cnightDecimals,
    status,
    statusLoading,
    registrationStatus,
    registrations,
    replicates,
    primaryRegistration,
    registering,
    stage,
    portalUrl,
    destinationOptions,
    selectedDestinationKey,
    refreshStatus,
    register,
    deregister,
    deregisterOutpoint,
    migrateDustAddressToOwn,
  };
}
