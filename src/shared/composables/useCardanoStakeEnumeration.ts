/**
 * Shared Cardano stake-identity enumeration for Midnight DUST features.
 *
 * From inside a logged Midnight wallet, resolves every Cardano identity the
 * user controls on the anchored Cardano network: the same-seed twin (the
 * Cardano identity derived from the Midnight wallet's own mnemonic) plus any
 * imported Cardano wallet records on that network. Public-xpub-only
 * derivation — no auth gesture, no mnemonic decryption required.
 *
 * Shared by BOTH:
 *  - `useDustSources` (cNIGHT sources dialog) — needs the full identity shape
 *    to build/sign mapping-validator transactions.
 *  - `useDustPathB` (DUST battery) — needs only the flat stake-address list
 *    to batch-query `dust/status`.
 *
 * These two surfaces used to derive independently and drifted in tolerance:
 * `useDustPathB`'s old inline `collectStakeAddresses` required only
 * `cardanoStakeAddress` for the twin (this module's `twinStakeIdentity`, like
 * the original `useDustSources.twinSource`, also requires
 * `cardanoBaseAddress`) and it tolerated `getAddress`/`getPaymentKeyExternal`
 * failures for imported records that `useDustSources.sourceFromRecord`
 * treated as a dropped row (any derivation failure drops the whole record).
 * Net effect: the DUST battery could count — and show DUST generated from —
 * a stake the cNIGHT sources dialog never listed, so a user could see DUST
 * with no visible source to manage it from.
 *
 * Both call sites now share this enumeration and its STRICTER tolerance
 * (the dialog's original one, unchanged here): a Cardano identity is
 * included only when every address needed to fully describe it resolves.
 * In practice `cardanoBaseAddress`/`cardanoStakeAddress`/
 * `cardanoPaymentKeyHashHex` are always derived together as a trio (see
 * `midnightKeyManager.ts` `deriveCardanoAddresses`), so requiring both
 * base + stake for the twin changes nothing observable there; the only real
 * behavior change is on the Path-B battery side, which now drops an
 * imported record exactly like the dialog already did.
 */
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { Blockchain, Wallet } from '@/models/types';
import { debugLog } from '@/utils/debug';

export interface CardanoStakeIdentity {
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
  /** False for watch-only / hardware records. */
  canSign: boolean;
  encryptionMethod: 'password' | 'prf';
}

export function walletCanSign(w: Partial<Wallet>): boolean {
  return !!(w.encryptedMnemonic || (w.prfEncryptedMnemonic && w.webAuthnCredentialId));
}

/** The Cardano identity derived from the logged Midnight wallet's own seed. */
function twinStakeIdentity(): CardanoStakeIdentity | null {
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
  };
}

/** Compute base/stake/payment-hash for an imported Cardano record from its public xpub. */
async function stakeIdentityFromRecord(
  w: Wallet & { publicKey?: string },
): Promise<CardanoStakeIdentity | null> {
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
    };
  } catch (e) {
    // Any derivation failure drops the whole record — a partially-derived
    // identity (e.g. a stake address with no matching base address) must not
    // surface anywhere, since callers rely on every field being present.
    debugLog('[useCardanoStakeEnumeration] Failed to derive addresses for wallet', w.id, e);
    return null;
  }
}

/**
 * Every Cardano identity the logged Midnight wallet can see on
 * `cardanoNetwork`: the same-seed twin (if fully derivable) plus imported
 * Cardano wallet records on that network, deduped by stake address.
 */
export async function enumerateCardanoStakeIdentities(
  cardanoNetwork: string,
): Promise<CardanoStakeIdentity[]> {
  const list: CardanoStakeIdentity[] = [];
  const twin = twinStakeIdentity();
  if (twin) list.push(twin);

  const records = Object.values(geroStore.wallets ?? {}) as Array<Wallet & { publicKey?: string }>;
  for (const w of records) {
    if (w.chain !== Blockchain.CARDANO || w.network !== cardanoNetwork) continue;
    const source = await stakeIdentityFromRecord(w);
    if (!source) continue;
    const existing = list.find((s) => s.stakeAddress === source.stakeAddress);
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
