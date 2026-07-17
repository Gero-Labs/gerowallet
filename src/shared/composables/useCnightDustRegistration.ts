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
import { getMidnightApi, MidnightDustRegistrationStatusDto } from '@/api/midnight-api';
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
  | { status: 'error'; message: string };

interface RegisterCredentials {
  /** Spending password (password wallets). */
  password?: string;
  /** Pre-evaluated PRF output from `evaluatePrfForWallet` (PassKey wallets). */
  prfOutput?: ArrayBuffer;
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

  const registrationStatus = computed<'Unregistered' | 'Pending' | 'Registered' | 'Invalid' | 'Unknown'>(() => {
    const s = status.value?.registrationStatus;
    // A confirmed on-chain status always wins over the local pending guard.
    if (s === 'Registered' || s === 'Invalid') return s;
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

  async function refreshStatus(): Promise<void> {
    const stakeAddress = loggedWallet.value?.stakeAddress;
    if (!isSupported.value || !stakeAddress) return;
    statusLoading.value = true;
    try {
      status.value = await getMidnightApi(network.value).getDustStatus(stakeAddress);
      // Reconcile the local pending guard: clear it once the indexer confirms
      // Registered; otherwise surface any un-expired local record.
      if (status.value?.registrationStatus === 'Registered') {
        clearDustPending(stakeAddress);
        localPending.value = null;
      } else {
        // Not Registered: reconcile the local guard against the chain so a
        // submission that never landed can't block re-registration for 24h.
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
      const destinationBech32 = chosen && chosen.key !== 'self' && chosen.dustAddress
        ? chosen.dustAddress
        : (await deriveMidnightAddresses(mnemonic, wallet.network)).dust;
      const dustAddressHex = dustAddressToHex(destinationBech32);

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
    registering,
    stage,
    portalUrl,
    destinationOptions,
    selectedDestinationKey,
    refreshStatus,
    register,
    deregister,
    migrateDustAddressToOwn,
  };
}
