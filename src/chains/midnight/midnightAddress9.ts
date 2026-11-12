import { MidnightBech32m, ShieldedAddress } from 'midnight-v9-address-format';

/** Longer than any Midnight address; bounds the work done on pasted input. */
const MAX_ADDRESS_LENGTH = 1024;

/**
 * Midnight shielded addresses exceed Bitcoin's 90-character limit. Wallet SDK
 * 2.0.0's `MidnightBech32m.parse` lifts that limit itself (beta.2 did not) and
 * keeps the checksum, casing and prefix checks. It ignores HRP segments after
 * the network one, so a fourth segment is refused here.
 */
export function parseMidnightAddress9(encoded: string): MidnightBech32m {
  if (typeof encoded !== 'string' || encoded.length > MAX_ADDRESS_LENGTH) throw new Error('Invalid Midnight address');
  const separator = encoded.lastIndexOf('1');
  const segments = separator > 0 ? encoded.slice(0, separator).split('_').length : 0;
  if (segments !== 2 && segments !== 3) throw new Error('Invalid Midnight address prefix');
  return MidnightBech32m.parse(encoded);
}

/** The codec checks the network and, since 4.0.0, the two 32-byte key lengths. */
export function decodeShieldedAddress9(network: string, encoded: string): ShieldedAddress {
  return ShieldedAddress.codec.decode(network, parseMidnightAddress9(encoded));
}
