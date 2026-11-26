/**
 * Identifier of a phase 1 (native script) vault (GV-60):
 *
 *   vaultId = blake2b-256( tag || magic || paymentScriptCbor || stakeScriptCbor )
 *
 * - `tag`: the 21 UTF-8 bytes of `gero-vault/v1|native|`.
 * - `magic`: the network magic as 4 bytes, big-endian (mainnet 764824073 = 2d964a09, preprod
 *   1 = 00000001, preview 2 = 00000002), so the same scripts on preprod and preview differ.
 * - the two scripts' CBOR exactly as `scripts.ts` builds them. Each CBOR item is self-delimiting,
 *   so the concatenation has a single reading and needs no length prefixes.
 *
 * The identifier depends on the scripts and the network only, never on a registration: a
 * registration is a discovery hint, and anyone can publish another one for the same scripts.
 *
 * PROVISIONAL: the encoding and the test vectors are not frozen until they are checked against
 * the other clients' vectors.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { hexToBytes, bytesToHex } from './cbor';
import { GeroVaultError } from './errors';
import { VaultNetwork, VaultScripts } from './types';

export const VAULT_ID_TAG = 'gero-vault/v1|native|';

export const NETWORK_MAGIC: Readonly<Record<VaultNetwork, number>> = Object.freeze({
  mainnet: 764824073,
  preprod: 1,
  preview: 2,
});

/** The bytes the identifier hashes, as hex (for cross-client vectors). */
export function vaultIdPreimage(vault: Pick<VaultScripts, 'payment' | 'stake'>, network: VaultNetwork): string {
  const magic = Object.prototype.hasOwnProperty.call(NETWORK_MAGIC, network) ? NETWORK_MAGIC[network] : undefined;
  if (magic === undefined) throw new GeroVaultError('UNKNOWN_NETWORK', 'A vault network is mainnet, preprod or preview');
  const payment = hexToBytes(vault?.payment?.cbor);
  const stake = hexToBytes(vault?.stake?.cbor);
  if (!payment || !stake || payment.length === 0 || stake.length === 0) {
    throw new GeroVaultError('UNKNOWN_TEMPLATE', 'A vault identifier needs both scripts');
  }
  const tag = new TextEncoder().encode(VAULT_ID_TAG);
  const out = new Uint8Array(tag.length + 4 + payment.length + stake.length);
  out.set(tag, 0);
  new DataView(out.buffer).setUint32(tag.length, magic, false);
  out.set(payment, tag.length + 4);
  out.set(stake, tag.length + 4 + payment.length);
  return bytesToHex(out);
}

/** The vault identifier, 32 bytes as lowercase hex. */
export function vaultId(vault: Pick<VaultScripts, 'payment' | 'stake'>, network: VaultNetwork): string {
  return bytesToHex(blake2b(hexToBytes(vaultIdPreimage(vault, network)), { dkLen: 32 }));
}
