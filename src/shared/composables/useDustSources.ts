/**
 * DUST sources — cross-wallet cNIGHT → DUST orchestration from the MIDNIGHT wallet.
 *
 * From inside a Midnight wallet, enumerates every Cardano identity the user
 * controls on the anchored Cardano network (Midnight preprod ↔ Cardano preprod
 * etc.), shows each one's NIGHT balance + DUST registration status, and lets
 * the user register/redirect DUST generation to THIS wallet's own DUST address:
 *
 *  - **Same-seed twin**: the Cardano identity derived from the Midnight
 *    wallet's own mnemonic. `MidnightAddresses` persists its base/stake
 *    addresses + payment key hash at derivation time, so it's shown with no
 *    auth gesture. Signing decrypts the logged wallet's mnemonic (one
 *    password/PassKey gesture).
 *  - **Imported Cardano wallets**: other wallet records (`geroStore.wallets`)
 *    on the same Cardano network. Addresses derive from each record's public
 *    xpub (no keys needed to display); signing requires THAT record's
 *    password/PassKey.
 *  - **Watch-only / hardware records**: listed read-only (no local mnemonic).
 *
 * Signing bypasses the logged-wallet SIGN_TX pipeline (which signs with the
 * logged wallet's keys) and instead builds the witness set locally in the
 * options context from the source's mnemonic — exactly the two witnesses the
 * mapping-validator tx requires (payment + stake, both in requiredSigners).
 * The tx id is recomputed from the CBOR before signing (never trust a
 * server-supplied hash), and submission goes through the standard SUBMIT_TX
 * path, which re-verifies the body hash while merging witnesses.
 *
 * Balances are public reads: Koios `address_assets` (host already in the
 * extension's CSP allowlist); statuses use the existing Nexus batch endpoint.
 */

import { computed, ref } from 'vue';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { Blockchain, CoinTypes, HARDENED, Network, Wallet, WalletTypePurpose } from '@/models/types';
import {
  getMidnightApi,
  MidnightDustRegistrationStatusDto,
} from '@/api/midnight-api';
import { CNIGHT_ASSETS } from '@/shared/composables/useCnightDustRegistration';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { debugLog } from '@/utils/debug';

export interface DustSource {
  /** Stable row key — the stake (reward) address. */
  key: string;
  /** Wallet name, or the logged Midnight wallet's name for the same-seed twin. */
  label: string;
  /** Imported wallet record id; null when the twin isn't separately imported. */
  walletId: number | null;
  /** True when this identity derives from the logged Midnight wallet's own seed. */
  sameSeed: boolean;
  baseAddress: string;
  stakeAddress: string;
  paymentKeyHashHex: string;
  /** False for watch-only / hardware records — row renders read-only. */
  canSign: boolean;
  encryptionMethod: 'password' | 'prf';
  /** Raw cNIGHT base units; null while loading / on query failure. */
  nightBalance: bigint | null;
  status: MidnightDustRegistrationStatusDto | null;
}

export type DustSourceActionResult =
  | { status: 'submitted'; txHash: string }
  | { status: 'error'; message: string };

interface SourceCredentials {
  password?: string;
  /** Pre-evaluated PRF output for the SOURCE wallet's credential. */
  prfOutput?: ArrayBuffer;
}

const KOIOS_BASES: Record<string, string> = {
  [Network.MAINNET]: 'https://api.koios.rest/api/v1',
  [Network.PREPROD]: 'https://preprod.koios.rest/api/v1',
  [Network.PREVIEW]: 'https://preview.koios.rest/api/v1',
};

const STATUS_BATCH_LIMIT = 50;

export function useDustSources() {
  const sources = ref<DustSource[]>([]);
  const loading = ref(false);
  const working = ref(false);

  const network = computed<string>(() => walletStore.loggedWallet?.network ?? '');
  const ownDustAddress = computed<string>(() => midnightStore.addresses?.dust ?? '');
  const isSupported = computed(() =>
    walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT && !!CNIGHT_ASSETS[network.value]);

  function walletCanSign(w: Partial<Wallet>): boolean {
    return !!(w.encryptedMnemonic || (w.prfEncryptedMnemonic && w.webAuthnCredentialId));
  }

  /** The Cardano identity derived from the logged Midnight wallet's own seed. */
  function twinSource(): DustSource | null {
    const addrs = midnightStore.addresses;
    const wallet = walletStore.loggedWallet;
    if (!wallet || !addrs?.cardanoBaseAddress || !addrs?.cardanoStakeAddress) return null;
    return {
      key: addrs.cardanoStakeAddress,
      label: wallet.name ?? 'This wallet',
      walletId: null,
      sameSeed: true,
      baseAddress: addrs.cardanoBaseAddress,
      stakeAddress: addrs.cardanoStakeAddress,
      paymentKeyHashHex: addrs.cardanoPaymentKeyHashHex ?? '',
      canSign: walletCanSign(wallet),
      encryptionMethod: wallet.encryptionMethod === 'prf' ? 'prf' : 'password',
      nightBalance: null,
      status: null,
    };
  }

  /** Compute base/stake/payment-hash for an imported Cardano record from its public xpub. */
  async function sourceFromRecord(w: Wallet & { publicKey?: string }): Promise<DustSource | null> {
    if (!w.publicKey) return null;
    try {
      const { getAddress, getRewardAddress, getPaymentKeyExternal } = await import('@/chrome/serialization');
      const baseAddress = getAddress(w.publicKey, Blockchain.CARDANO, w.network, 0).toBech32();
      const stakeAddress = getRewardAddress(w.publicKey, Blockchain.CARDANO, w.network).toBech32();
      const paymentKeyHashHex = getPaymentKeyExternal(w.publicKey, 0).hash().hex();
      return {
        key: stakeAddress,
        label: w.name,
        walletId: w.id,
        sameSeed: false,
        baseAddress,
        stakeAddress,
        paymentKeyHashHex,
        canSign: walletCanSign(w),
        encryptionMethod: w.encryptionMethod === 'prf' ? 'prf' : 'password',
        nightBalance: null,
        status: null,
      };
    } catch (e) {
      debugLog('[DustSources] Failed to derive addresses for wallet', w.id, e);
      return null;
    }
  }

  async function enumerate(): Promise<DustSource[]> {
    const list: DustSource[] = [];
    const twin = twinSource();
    if (twin) list.push(twin);

    const records = Object.values(geroStore.wallets ?? {}) as Array<Wallet & { publicKey?: string }>;
    for (const w of records) {
      if (w.chain !== Blockchain.CARDANO || w.network !== network.value) continue;
      const source = await sourceFromRecord(w);
      if (!source) continue;
      const existing = list.find(s => s.stakeAddress === source.stakeAddress);
      if (existing) {
        // The twin is also imported as its own Cardano wallet record — one row,
        // signable through either credential set. Prefer the imported record's
        // name and keep sameSeed so the logged wallet's gesture suffices.
        existing.walletId = source.walletId;
        existing.label = source.label;
        existing.canSign = existing.canSign || source.canSign;
        continue;
      }
      list.push(source);
    }
    return list;
  }

  /** Sum each source's cNIGHT via Koios `address_assets` (public, batched). */
  async function loadBalances(list: DustSource[]): Promise<void> {
    const asset = CNIGHT_ASSETS[network.value];
    const base = KOIOS_BASES[network.value];
    if (!asset || !base || list.length === 0) return;
    try {
      const res = await fetch(`${base}/address_assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _addresses: list.map(s => s.baseAddress) }),
      });
      if (!res.ok) throw new Error(`Koios address_assets ${res.status}`);
      const rows = await res.json() as Array<{
        address: string; policy_id: string; asset_name: string | null; quantity: string;
      }>;
      const byAddress = new Map<string, bigint>();
      for (const s of list) byAddress.set(s.baseAddress, 0n);
      for (const r of rows) {
        if (r.policy_id !== asset.policyId) continue;
        if ((r.asset_name ?? '') !== asset.assetNameHex) continue;
        byAddress.set(r.address, (byAddress.get(r.address) ?? 0n) + BigInt(r.quantity));
      }
      for (const s of list) s.nightBalance = byAddress.get(s.baseAddress) ?? 0n;
    } catch (e) {
      debugLog('[DustSources] balance query failed:', e);
      // Leave balances null — rows render as unknown rather than zero.
    }
  }

  async function loadStatuses(list: DustSource[]): Promise<void> {
    if (list.length === 0) return;
    const api = getMidnightApi(network.value);
    for (let i = 0; i < list.length; i += STATUS_BATCH_LIMIT) {
      const chunk = list.slice(i, i + STATUS_BATCH_LIMIT);
      try {
        const statuses = await api.getDustStatusBatch(chunk.map(s => s.stakeAddress));
        for (const st of statuses) {
          const source = chunk.find(s => s.stakeAddress === st.cardanoRewardAddress);
          if (source) source.status = st;
        }
      } catch (e) {
        debugLog('[DustSources] status batch failed:', e);
      }
    }
  }

  async function refresh(): Promise<void> {
    if (!isSupported.value) {
      sources.value = [];
      return;
    }
    loading.value = true;
    try {
      const list = await enumerate();
      sources.value = list;
      await Promise.all([loadBalances(list), loadStatuses(list)]);
      // Reassign to poke reactivity after in-place mutation of row fields.
      sources.value = [...list];
    } finally {
      loading.value = false;
    }
  }

  /** Decrypt the SOURCE wallet's mnemonic (the logged wallet's for the twin). */
  async function decryptSourceMnemonic(
    source: DustSource, credentials: SourceCredentials,
  ): Promise<string> {
    const record: (Wallet & { id: number }) | undefined = source.sameSeed
      ? walletStore.loggedWallet
      : (geroStore.wallets ?? {})[source.walletId as number] as Wallet;
    if (!record) throw new Error('Source wallet record not found');

    if (credentials.prfOutput) {
      if (!record.prfEncryptedMnemonic || !record.webAuthnCredentialId) {
        throw new Error('PassKey wallet is missing its encrypted mnemonic');
      }
      const { decryptMnemonicWithPrfOutput } = await import('@/shared/utils/webauthn-prf');
      return decryptMnemonicWithPrfOutput(
        record.prfEncryptedMnemonic,
        credentials.prfOutput,
        record.webAuthnCredentialId,
        record.id.toString(),
      );
    }
    if (!record.encryptedMnemonic) {
      throw new Error('Wallet has no local mnemonic (hardware or watch-only)');
    }
    const { decrypt } = await import('@/shared/utils/crypto');
    try {
      return decrypt(record.encryptedMnemonic, credentials.password ?? '');
    } catch {
      throw new Error('WRONG_PASSWORD');
    }
  }

  /**
   * Sign the mapping tx locally with the source's payment + stake keys.
   * The tx id is recomputed from the CBOR (deserialize) — the witness signs
   * what will actually be submitted, not a server-claimed hash.
   */
  async function signWithMnemonic(txCbor: string, mnemonic: string): Promise<string> {
    const [{ deserializeCardanoJsSdkTx }, { Serialization }, { HexBlob }, { resolvePrivateKey }] =
      await Promise.all([
        import('@/chrome/cardanoJsSdkCbor'),
        import('@cardano-sdk/core'),
        import('@cardano-sdk/util'),
        import('@/shared/utils/resolver'),
      ]);
    const transaction = deserializeCardanoJsSdkTx(txCbor);
    const rootKey = resolvePrivateKey(mnemonic);
    const accountKey = rootKey.derive([
      WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED,
    ]);

    const signatures = new Map<string, string>();
    // External payment key [0,0] witnesses the inputs; stake key [2,0] satisfies
    // the validator's extra_signatories check on the datum's c_wallet.
    for (const path of [[0, 0], [2, 0]]) {
      const key = accountKey.derive(path);
      const raw = key.toRawKey();
      signatures.set(raw.toPublic().hex(), raw.sign(HexBlob(transaction.id)).hex());
    }
    const witness = { signatures } as Parameters<typeof Serialization.TransactionWitnessSet.fromCore>[0];
    return Serialization.TransactionWitnessSet.fromCore(witness).toCbor();
  }

  /** Guard: the decrypted seed must actually derive this source's address. */
  async function assertSeedMatchesSource(mnemonic: string, source: DustSource): Promise<void> {
    const { getAddress } = await import('@/chrome/serialization');
    const { resolvePrivateKey } = await import('@/shared/utils/resolver');
    const { SodiumBip32Ed25519 } = await import('@cardano-sdk/crypto');
    const { bech32 } = await import('bech32');
    const rootKey = resolvePrivateKey(mnemonic);
    const bip32Ed25519 = await SodiumBip32Ed25519.create();
    const xpubHex = bip32Ed25519.getBip32PublicKey(
      rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED]).hex(),
    );
    const xpub = bech32.encode('xpub', bech32.toWords(Buffer.from(xpubHex, 'hex')), 120);
    const derivedBase = getAddress(xpub, Blockchain.CARDANO, network.value, 0).toBech32();
    if (derivedBase !== source.baseAddress) {
      throw new Error('Decrypted seed does not derive this Cardano address');
    }
  }

  async function submitViaBackground(txCbor: string, witnessHex: string): Promise<string> {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SUBMIT_TX,
      data: { txCbor, witnessHex, utxos: [] },
    }) as { data: { txId?: string; error?: string } };
    if (!response?.data?.txId) {
      throw new Error(response?.data?.error || 'Transaction submission failed');
    }
    return response.data.txId;
  }

  /** Register `source`'s NIGHT to generate DUST at THIS Midnight wallet's address. */
  async function registerSource(
    source: DustSource, credentials: SourceCredentials,
  ): Promise<DustSourceActionResult> {
    if (!ownDustAddress.value) {
      return { status: 'error', message: 'This wallet has no DUST address yet' };
    }
    working.value = true;
    try {
      const mnemonic = await decryptSourceMnemonic(source, credentials);
      await assertSeedMatchesSource(mnemonic, source);

      const { dustAddressToHex } = await import('@/chains/midnight/midnightKeyManager');
      const build = await getMidnightApi(network.value).buildDustRegistrationTx({
        cardanoAddress: source.baseAddress,
        paymentKeyHashHex: source.paymentKeyHashHex,
        dustAddressHex: dustAddressToHex(ownDustAddress.value),
      });
      if (build.status !== 'complete' || !build.txCbor) {
        throw new Error(build.note || 'Nexus did not return a complete registration transaction');
      }

      const witnessHex = await signWithMnemonic(build.txCbor, mnemonic);
      const txId = await submitViaBackground(build.txCbor, witnessHex);

      source.status = {
        cardanoRewardAddress: source.stakeAddress,
        dustAddress: ownDustAddress.value,
        registered: false,
        registrationStatus: 'Pending',
        registrationUtxoTxHash: txId,
      };
      sources.value = [...sources.value];
      return { status: 'submitted', txHash: txId };
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
    } finally {
      working.value = false;
    }
  }

  /** Re-point `source`'s existing registration at THIS wallet's DUST address. */
  async function redirectSource(
    source: DustSource, credentials: SourceCredentials,
  ): Promise<DustSourceActionResult> {
    const txHash = source.status?.registrationUtxoTxHash;
    const outputIndex = source.status?.registrationUtxoOutputIndex;
    if (!ownDustAddress.value) {
      return { status: 'error', message: 'This wallet has no DUST address yet' };
    }
    if (!txHash || outputIndex === null || outputIndex === undefined) {
      return { status: 'error', message: 'Registration UTxO not known yet. Refresh and try again.' };
    }
    working.value = true;
    try {
      const mnemonic = await decryptSourceMnemonic(source, credentials);
      await assertSeedMatchesSource(mnemonic, source);

      const { dustAddressToHex } = await import('@/chains/midnight/midnightKeyManager');
      const build = await getMidnightApi(network.value).buildDustUpdateTx({
        cardanoAddress: source.baseAddress,
        paymentKeyHashHex: source.paymentKeyHashHex,
        registrationUtxoTxHash: txHash,
        registrationUtxoOutputIndex: outputIndex,
        dustAddressHex: dustAddressToHex(ownDustAddress.value),
      });
      if (build.status !== 'complete' || !build.txCbor) {
        throw new Error(build.note || 'Nexus did not return a complete update transaction');
      }

      const witnessHex = await signWithMnemonic(build.txCbor, mnemonic);
      const txId = await submitViaBackground(build.txCbor, witnessHex);

      source.status = {
        cardanoRewardAddress: source.stakeAddress,
        dustAddress: ownDustAddress.value,
        registered: false,
        registrationStatus: 'Pending',
        registrationUtxoTxHash: txId,
      };
      sources.value = [...sources.value];
      return { status: 'submitted', txHash: txId };
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
    } finally {
      working.value = false;
    }
  }

  return {
    sources,
    loading,
    working,
    isSupported,
    ownDustAddress,
    refresh,
    registerSource,
    redirectSource,
  };
}
