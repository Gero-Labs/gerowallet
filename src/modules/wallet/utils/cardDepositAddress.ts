import { Cardano } from '@cardano-sdk/core';

/**
 * True when `candidate` is safe to send ADA to as a card deposit: a bech32
 * payment address (base, enterprise or pointer) on the wallet's own network.
 * These transfers are irreversible, so anything else is refused.
 */
export function isCardDepositAddress(
  candidate: unknown,
  walletNetworkId: Cardano.NetworkId,
): candidate is Cardano.PaymentAddress {
  if (typeof candidate !== 'string' || !Cardano.Address.isValidBech32(candidate)) return false;
  const address = Cardano.Address.fromBech32(candidate);
  if (!(address.asBase() || address.asEnterprise() || address.asPointer())) return false;
  return address.getNetworkId() === walletNetworkId;
}

/** Network of a bech32 address, e.g. the signed-in wallet's own base address. */
export function networkIdOfAddress(bech32: string): Cardano.NetworkId {
  return Cardano.Address.fromBech32(bech32).getNetworkId();
}
