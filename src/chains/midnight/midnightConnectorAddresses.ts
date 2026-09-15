/**
 * DApp Connector `getShieldedAddresses()` payload.
 *
 * The spec (`@midnight-ntwrk/dapp-connector-api` `ConnectedAPI`) says the
 * address AND both public keys are "provided in Bech32m format". The keys
 * therefore go out as `mn_shield-cpk_<net>1…` / `mn_shield-epk_<net>1…`, not
 * as the hex `ShieldedAddress.coinPublicKeyString()` returns — a dapp feeding
 * hex to its bech32m decoder fails with "Invalid checksum in <hex>".
 */

import type { ShieldedAddress as ShieldedAddressType } from '@midnightntwrk/wallet-sdk-address-format';

export interface ConnectorShieldedAddresses {
  shieldedAddress: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
}

/** The slice of `@midnightntwrk/wallet-sdk-address-format` this needs (injected so callers control loading). */
export interface ShieldedAddressCodecs {
  ShieldedAddress: { codec: { decode(networkId: string, repr: unknown): ShieldedAddressType } };
  ShieldedCoinPublicKey: { codec: { encode(networkId: string, data: ShieldedAddressType['coinPublicKey']): { toString(): string } } };
  ShieldedEncryptionPublicKey: { codec: { encode(networkId: string, data: ShieldedAddressType['encryptionPublicKey']): { toString(): string } } };
  MidnightBech32m: { parse(bech32string: string): unknown };
}

/**
 * Decode the wallet's bech32m shielded address and re-encode its two public
 * keys as bech32m under the same network id.
 */
export function connectorShieldedAddresses(
  codecs: ShieldedAddressCodecs,
  sdkNetworkId: string,
  shieldedAddress: string,
): ConnectorShieldedAddresses {
  const decoded = codecs.ShieldedAddress.codec.decode(sdkNetworkId, codecs.MidnightBech32m.parse(shieldedAddress));
  return {
    shieldedAddress,
    shieldedCoinPublicKey: codecs.ShieldedCoinPublicKey.codec.encode(sdkNetworkId, decoded.coinPublicKey).toString(),
    shieldedEncryptionPublicKey: codecs.ShieldedEncryptionPublicKey.codec.encode(sdkNetworkId, decoded.encryptionPublicKey).toString(),
  };
}
