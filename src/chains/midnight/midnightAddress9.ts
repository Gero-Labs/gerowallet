import { bech32m } from 'bech32';
import { mainnet, MidnightBech32m, ShieldedAddress } from 'midnight-v9-address-format';

/**
 * Midnight shielded addresses exceed Bitcoin's default 90-character limit.
 * Keep the checksum, casing, padding, HRP and network checks; only increase
 * the length bound. The beta.2 SDK parser's decodeToBytes uses a 90-char cap.
 */
export function parseMidnightAddress9(encoded: string): MidnightBech32m {
  const decoded = bech32m.decode(encoded, 1024);
  const segments = decoded.prefix.split('_');
  if (segments[0] !== 'mn' || (segments.length !== 2 && segments.length !== 3)) {
    throw new Error('Invalid Midnight address prefix');
  }
  const [, type, network] = segments;
  return new MidnightBech32m(type, network ?? mainnet, Buffer.from(bech32m.fromWords(decoded.words)));
}

export function decodeShieldedAddress9(network: string, encoded: string): ShieldedAddress {
  const parsed = parseMidnightAddress9(encoded);
  // beta.2's public-key constructors don't enforce their documented lengths.
  if (parsed.data.length !== 64) throw new Error('A Midnight shielded address requires two 32-byte public keys');
  return ShieldedAddress.codec.decode(network, parsed);
}
