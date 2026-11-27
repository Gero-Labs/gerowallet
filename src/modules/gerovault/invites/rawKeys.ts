/**
 * An accepted cosigner's two vault keys arrive as raw Ed25519 public keys (`PROTOCOL.md` 4.2,
 * checked usable when the ACCEPT was opened). The create flow reads them through the library's own
 * reader, so they take the same path as keys pasted by hand.
 */
import { bech32 } from 'bech32';
import { BECH32_PREFIX, parseVaultPublicKeys, type VaultPublicKeys } from '@/shared/gerovault';
import { hexToBytes } from '@/shared/gerovault/cbor';

function bytesOf(hex: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (!bytes) throw new TypeError('Expected hex');
  return bytes;
}

/** The typed vault keys of two raw Ed25519 public keys. Throws `GeroVaultError` or `TypeError`. */
export function vaultKeysFromRaw(payment: string, stake: string): VaultPublicKeys {
  return parseVaultPublicKeys({
    payment: bech32.encode(BECH32_PREFIX.PAYMENT_VK, bech32.toWords(bytesOf(payment)), 200),
    stake: bech32.encode(BECH32_PREFIX.STAKE_VK, bech32.toWords(bytesOf(stake)), 200),
  });
}
