/**
 * Midnight HD key + address derivation.
 *
 * Wraps `@midnightntwrk/wallet-sdk-hd` (HDWallet at `m/44'/2400'/account'/role/index`)
 * and `@midnightntwrk/wallet-sdk-unshielded-wallet`'s `createKeystore` so the
 * wallet can derive a Midnight unshielded address from a BIP39 mnemonic.
 *
 * Roles (per the SDK constant `Roles`):
 *   - NightExternal (0): unshielded receive addresses (`mn_addr_*`)
 *   - NightInternal (1): unshielded change
 *   - Dust          (2): dust address  (`mn_dust-addr_*`)
 *   - Zswap         (3): shielded address (`mn_shield-addr_*`)
 *   - Metadata      (4): metadata
 *
 * **Current scope (v1):** unshielded-only. The shielded address requires both
 * the Zswap coin public key and an encryption public key derived from the
 * SDK's shielded-wallet flow — that lands once we wire the full
 * `wallet-sdk-shielded` + ledger-v8 surface. Dust addresses also need the
 * dust-wallet derivation; both placeholder values here.
 *
 * The unshielded address is the one gero-sync subscribes to, so it's the
 * load-bearing piece for end-to-end sync.
 */

import * as bip39 from 'bip39';
import { HDWallet, Roles } from '@midnightntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DustSecretKey, ZswapSecretKeys } from '@midnight-ntwrk/ledger-v8';
import {
  DustAddress,
  MidnightBech32m,
  ShieldedEncryptionSecretKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import { bech32, bech32m } from 'bech32';
import {
  Bip32Ed25519,
  Bip32PublicKeyHex,
  SodiumBip32Ed25519,
} from '@cardano-sdk/crypto';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { getAddress, getPaymentKeyExternal, getRewardAddress } from '@/chrome/serialization';
import {
  Blockchain,
  CoinTypes,
  HARDENED,
  Network,
  WalletTypePurpose,
} from '@/models/types';
import type { MidnightAddresses } from '@/chains/midnight/midnightTypes';

/**
 * Map our project's `Network` constants to the SDK's NetworkId strings.
 * The SDK accepts `'mainnet' | 'testnet' | 'devnet' | 'qanet' | 'undeployed'
 * | 'preview' | 'preprod'` — see
 * `@midnightntwrk/wallet-sdk-abstractions/dist/NetworkId.d.ts`.
 */
function midnightNetworkId(network: string): string {
  switch (network) {
    case Network.MAINNET:
      return 'mainnet';
    case Network.PREVIEW:
      return 'preview';
    case Network.PREPROD:
      return 'preprod';
    case Network.TESTNET:
      return 'testnet';
    default:
      throw new Error(`Unsupported Midnight network: ${network}`);
  }
}

export interface MidnightDerivedKeys {
  /** Raw 64-byte BIP39 seed — kept so callers can hand it to the shielded SDK. */
  seed: Uint8Array;
  /** 32-byte private key for role NightExternal at index 0 (unshielded receive). */
  unshieldedSecretKey: Uint8Array;
  /** 32-byte private key for role Dust at index 0; consumed by DustWallet for fee payment + DUST registration tx signing. */
  dustSecretKey: Uint8Array;
  /**
   * 32-byte private key for role Zswap at index 0 — the seed used to derive
   * the full {@link ZswapSecretKeys} for shielded note decryption and shielded
   * tx signing. Caller must wipe (\`.fill(0)\`) after use. Mirrors how
   * {@code dustSecretKey} is passed to {@code DustSecretKey.fromSeed} in the
   * unshielded tx-build path.
   */
  zswapSecretKey: Uint8Array;
  /**
   * Bech32m-encoded Zswap encryption SECRET key (`mn_shield-esk_<network>1…`
   * for non-mainnet, bare `mn_shield-esk…` for mainnet) — what the Midnight
   * indexer calls the "viewing key" in its `connect(viewingKey: ViewingKey!)`
   * mutation. Despite the name, this is secret-key material — the indexer
   * needs it to decrypt incoming shielded notes on the user's behalf
   * (same shape as Zcash's IVK).
   *
   * Wire form is bech32m with HRP `shield-esk`, network-suffixed for non-
   * mainnet. The indexer rejects raw hex AND rejects the encryption PUBLIC
   * key under `shield-epk` — both produce
   * `"invalid viewing key: cannot bech32m-decode viewing key"`.
   *
   * BLAST RADIUS: anyone with this string can decrypt every incoming
   * shielded note for this wallet, forever. Cannot spend (spend requires
   * the coin secret key) but can de-anonymize. Currently persisted on the
   * wallet record in plain form alongside the public addresses (sandbox
   * is extension-scoped IndexedDB); followup is encrypted-at-rest storage
   * alongside the mnemonic.
   */
  zswapViewingKey: string;
  /** Computed bech32m unshielded address (`mn_addr_<network>1...`). */
  addresses: MidnightAddresses;
  /** Raw signing public key hex (`UnshieldedKeystore.getPublicKey()`). Needed by Nexus sidecar for seedless wallet construction. */
  publicKeyHex: string;
  /** Address bytes as hex (`UnshieldedKeystore.getAddress()`). Needed by Nexus sidecar for seedless wallet construction. */
  addressHex: string;
  /** Cardano CIP-1852 account 0 xpub (bech32 `xpub1...`). Used to sign DUST registration txs on Cardano. */
  cardanoXpub: string;
  /** Cardano base address at external chain index 0 (bech32 `addr1...`/`addr_test1...`). */
  cardanoBaseAddress: string;
  /** Cardano stake/reward address (bech32 `stake1...`/`stake_test1...`). */
  cardanoStakeAddress: string;
  /** 28-byte hex payment-key hash for the Cardano base address. Sent to Nexus DUST builder. */
  cardanoPaymentKeyHashHex: string;
}

/**
 * Derive the Cardano CIP-1852 xpub + primary base/stake address from the
 * wallet's BIP39 mnemonic. Mirrors `derivePublicKeyFromMnemonic` in
 * `gero-db.ts` but co-located so a single mnemonic produces both the Midnight
 * HD material and the Cardano material in one pass — matching Lace's pattern
 * of one wallet seed feeding every per-chain integration module.
 */
async function deriveCardanoMaterial(
  mnemonic: string,
  network: string,
  account = 0,
): Promise<{
  cardanoXpub: string;
  cardanoBaseAddress: string;
  cardanoStakeAddress: string;
  cardanoPaymentKeyHashHex: string;
}> {
  const rootKey = resolvePrivateKey(mnemonic);
  const bip32Ed25519: Bip32Ed25519 = await SodiumBip32Ed25519.create();
  const xpubHex: Bip32PublicKeyHex = bip32Ed25519.getBip32PublicKey(
    rootKey
      .derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + account])
      .hex(),
  );
  let words: number[];
  try {
    words = bech32.toWords(Buffer.from(xpubHex, 'hex'));
  } catch {
    words = bech32m.toWords(Buffer.from(xpubHex, 'hex'));
  }
  const cardanoXpub = bech32.encode('xpub', words, 120);

  const cardanoBaseAddress = getAddress(cardanoXpub, Blockchain.CARDANO, network, 0).toBech32();
  const cardanoStakeAddress = getRewardAddress(cardanoXpub, Blockchain.CARDANO, network).toBech32();
  const cardanoPaymentKeyHashHex = getPaymentKeyExternal(cardanoXpub, 0).hash().hex();

  return {
    cardanoXpub,
    cardanoBaseAddress,
    cardanoStakeAddress,
    cardanoPaymentKeyHashHex,
  };
}

/**
 * Derive role-specific Midnight keys + addresses from a BIP39 mnemonic.
 *
 * Throws on:
 *   - invalid mnemonic / failed seed → "Invalid Midnight mnemonic"
 *   - HD path overflow (extremely rare) → "Midnight key derivation out of bounds"
 *   - unknown network passed in → "Unsupported Midnight network: ..."
 *
 * @param mnemonic BIP39 phrase (24 words for new wallets; 12/15/24 supported)
 * @param network  One of `Network.PREVIEW | PREPROD | MAINNET | TESTNET`
 * @param account  HD account index (defaults to 0)
 */
export async function deriveMidnightKeys(
  mnemonic: string,
  network: string,
  account = 0,
  /**
   * Skip Cardano (CIP-1852) material derivation. Set true on signing-only
   * paths inside the background service worker, where the bundled pbkdf2/
   * sha512 polyfill chain crashes with "Cannot set properties of undefined
   * (setting 'NaN')". The Midnight signing flow only needs the
   * NightExternal key, so Cardano material is dead weight here.
   */
  options: { skipCardano?: boolean } = {},
): Promise<MidnightDerivedKeys> {
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  const result = HDWallet.fromSeed(seed);
  if (result.type !== 'seedOk') {
    throw new Error('Invalid Midnight mnemonic');
  }
  const hdWallet = result.hdWallet;
  const accountKey = hdWallet.selectAccount(account);

  // Unshielded receive address: NightExternal role, index 0.
  const externalRoleKey = accountKey.selectRole(Roles.NightExternal).deriveKeyAt(0);
  if (externalRoleKey.type !== 'keyDerived') {
    throw new Error('Midnight key derivation out of bounds');
  }
  const unshieldedSecretKey = externalRoleKey.key;

  // Dust address: Roles.Dust at index 0. The DustSecretKey wraps the role-derived
  // 32-byte key; its public key encodes to the `mn_dust-addr_<network>1…` bech32m
  // string used in DUST registration mappings.
  const dustRoleKey = accountKey.selectRole(Roles.Dust).deriveKeyAt(0);
  if (dustRoleKey.type !== 'keyDerived') {
    throw new Error('Midnight key derivation out of bounds');
  }
  const dustSecretKey = dustRoleKey.key;

  // Zswap (shielded) keys: Roles.Zswap at index 0 gives a 32-byte seed for
  // ZswapSecretKeys.fromSeed. The encryptionPublicKey is the wallet's viewing
  // key — what gero-sync forwards to the indexer's connect mutation. Coin and
  // encryption secret keys stay in BG memory only for signing paths; public
  // viewing key is safe to persist on the wallet record so login can supply
  // it to gero-sync without re-decrypting the mnemonic.
  const zswapRoleKey = accountKey.selectRole(Roles.Zswap).deriveKeyAt(0);
  if (zswapRoleKey.type !== 'keyDerived') {
    throw new Error('Midnight key derivation out of bounds');
  }
  const zswapSecretKey = zswapRoleKey.key;

  const networkId = midnightNetworkId(network);
  const keystore = createKeystore(unshieldedSecretKey, networkId);
  const unshieldedAddress = keystore.getBech32Address().toString();
  // These two are needed by the Nexus sidecar for seedless wallet construction.
  const publicKeyHex = keystore.getPublicKey() as unknown as string;
  const addressHex = keystore.getAddress() as unknown as string;

  const dustSk = DustSecretKey.fromSeed(dustSecretKey);
  const dustAddress = DustAddress.encodePublicKey(networkId, dustSk.publicKey);
  dustSk.clear();

  // Derive the viewing key from the Zswap secret. ZswapSecretKeys.fromSeed
  // is the SDK's canonical constructor.
  //
  // The Midnight indexer's `connect(viewingKey: ViewingKey!)` mutation —
  // per the indexer source at
  // `midnight-indexer/indexer-api/src/infra/api/v4/viewing_key.rs` —
  // decodes the input as bech32m with HRP `shield-esk` (encryption SECRET
  // key), then deserializes the bytes as a `ledger::SecretKey`. That's
  // because the indexer needs the secret material to decrypt incoming
  // notes on the user's behalf (same shape as Zcash's IVK: the "viewing
  // key" IS a secret in this design, despite the term).
  //
  // Subtle: an earlier iteration of this code encoded the encryption
  // PUBLIC key under HRP `shield-epk`. That looks like it should work —
  // it's still bech32m — but the indexer rejects it with InvalidHrp /
  // SecretKey-deserialize failure. The wallet SDK's
  // ShieldedEncryptionSecretKey codec is the one whose output the
  // indexer accepts.
  //
  // PRIVACY: this is encryption SECRET-key material persisted in plain
  // form on the wallet record. The blast radius is "anyone with this
  // can decrypt every incoming shielded note for this wallet, forever"
  // — strictly worse than a viewing key in the Zcash IPK sense. Sandbox
  // is IndexedDB (extension-scoped). Followup: move to encrypted-at-rest
  // storage alongside the mnemonic.
  const zswapKeys = ZswapSecretKeys.fromSeed(zswapSecretKey);
  const zswapEsk = new ShieldedEncryptionSecretKey(zswapKeys.encryptionSecretKey);
  const zswapViewingKey = ShieldedEncryptionSecretKey.codec
    .encode(networkId, zswapEsk)
    .toString();
  zswapKeys.clear();

  // Wipe HD private material once the addresses are derived.
  hdWallet.clear();

  // Derive the Cardano CIP-1852 material from the same mnemonic so a single
  // Midnight wallet can natively sign Cardano-side DUST registration txs
  // without requiring a separate Cardano wallet (Lace pattern).
  // Skipped on signing-only paths (see options.skipCardano above).
  const cardano = options.skipCardano
    ? { cardanoXpub: '', cardanoBaseAddress: '', cardanoStakeAddress: '', cardanoPaymentKeyHashHex: '' }
    : await deriveCardanoMaterial(mnemonic, network, account);

  // Shielded address (mn_shield-addr_…) requires the bech32m encoding of the
  // combined coin+encryption public keys. Deferred to a follow-up: today the
  // dashboard still doesn't render a shielded balance, so the bech32 form
  // isn't load-bearing. The viewing key is what unlocks gero-sync shielded
  // subscription, and that's what we ship here.
  const addresses: MidnightAddresses = {
    unshielded: unshieldedAddress,
    shielded: '',
    dust: dustAddress,
    publicKeyHex,
    addressHex,
    zswapViewingKey,
    cardanoXpub: cardano.cardanoXpub,
    cardanoBaseAddress: cardano.cardanoBaseAddress,
    cardanoStakeAddress: cardano.cardanoStakeAddress,
    cardanoPaymentKeyHashHex: cardano.cardanoPaymentKeyHashHex,
  };

  return {
    seed,
    unshieldedSecretKey,
    dustSecretKey,
    zswapSecretKey,
    zswapViewingKey,
    addresses,
    publicKeyHex,
    addressHex,
    cardanoXpub: cardano.cardanoXpub,
    cardanoBaseAddress: cardano.cardanoBaseAddress,
    cardanoStakeAddress: cardano.cardanoStakeAddress,
    cardanoPaymentKeyHashHex: cardano.cardanoPaymentKeyHashHex,
  };
}

/**
 * Public-facing helper: just the addresses (no private material). Used by the
 * UI / sync wiring at login time when the wallet has its decrypted seed.
 */
export async function deriveMidnightAddresses(
  mnemonic: string,
  network: string,
  account = 0,
): Promise<MidnightAddresses> {
  const derived = await deriveMidnightKeys(mnemonic, network, account);
  return derived.addresses;
}

/**
 * Decode a bech32m DUST address (`mn_dust-addr_<network>1…`) back to its raw
 * payload hex. Needed by `dust/build-registration-tx` which inlines the bytes
 * into the validator's datum (`dust_address: ByteArray`, ≤ 33 bytes).
 */
export function dustAddressToHex(bech32Address: string): string {
  const parsed = MidnightBech32m.parse(bech32Address);
  return parsed.data.toString('hex');
}
