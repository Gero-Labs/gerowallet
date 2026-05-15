/**
 * Midnight HD key + address derivation.
 *
 * Wraps `@midnight-ntwrk/wallet-sdk-hd` (HDWallet at `m/44'/2400'/account'/role/index`)
 * and `@midnight-ntwrk/wallet-sdk-unshielded-wallet`'s `createKeystore` so the
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
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustSecretKey } from '@midnight-ntwrk/ledger-v8';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { Network } from '@/models/types';
import type { MidnightAddresses } from '@/chains/midnight/midnightTypes';

/**
 * Map our project's `Network` constants to the SDK's NetworkId strings.
 * The SDK accepts `'mainnet' | 'testnet' | 'devnet' | 'qanet' | 'undeployed'
 * | 'preview' | 'preprod'` — see
 * `@midnight-ntwrk/wallet-sdk-abstractions/dist/NetworkId.d.ts`.
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
  /** Computed bech32m unshielded address (`mn_addr_<network>1...`). */
  addresses: MidnightAddresses;
  /** Raw signing public key hex (`UnshieldedKeystore.getPublicKey()`). Needed by Nexus sidecar for seedless wallet construction. */
  publicKeyHex: string;
  /** Address bytes as hex (`UnshieldedKeystore.getAddress()`). Needed by Nexus sidecar for seedless wallet construction. */
  addressHex: string;
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
export function deriveMidnightKeys(
  mnemonic: string,
  network: string,
  account = 0,
): MidnightDerivedKeys {
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

  const networkId = midnightNetworkId(network);
  const keystore = createKeystore(unshieldedSecretKey, networkId);
  const unshieldedAddress = keystore.getBech32Address().toString();
  // These two are needed by the Nexus sidecar for seedless wallet construction.
  const publicKeyHex = keystore.getPublicKey() as unknown as string;
  const addressHex = keystore.getAddress() as unknown as string;

  const dustSk = DustSecretKey.fromSeed(dustSecretKey);
  const dustAddress = DustAddress.encodePublicKey(networkId, dustSk.publicKey);
  dustSk.clear();

  // Wipe HD private material once the addresses are derived.
  hdWallet.clear();

  // Shielded address still requires the Zswap wallet's coin + encryption keys
  // from `wallet-sdk-shielded`. That landing is gated on the WASM bundle
  // decision; until then the dashboard renders a "Pending SDK integration" hint.
  const addresses: MidnightAddresses = {
    unshielded: unshieldedAddress,
    shielded: '',
    dust: dustAddress,
    publicKeyHex,
    addressHex,
  };

  return {
    seed,
    unshieldedSecretKey,
    dustSecretKey,
    addresses,
    publicKeyHex,
    addressHex,
  };
}

/**
 * Public-facing helper: just the addresses (no private material). Used by the
 * UI / sync wiring at login time when the wallet has its decrypted seed.
 */
export function deriveMidnightAddresses(
  mnemonic: string,
  network: string,
  account = 0,
): MidnightAddresses {
  return deriveMidnightKeys(mnemonic, network, account).addresses;
}
