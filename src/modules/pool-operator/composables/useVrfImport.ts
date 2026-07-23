import blockchainApi from '@/api/blockchain-api';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';

/**
 * VRF key handling for pool setup.
 *
 * The pool registration certificate stores the VRF *key hash* (blake2b-256 of the
 * raw VRF verification key) — the same value `cardano-cli` derives from
 * --vrf-verification-key-file, and the value pool-info APIs return as
 * `vrf_key_hash`. The SDK serializer writes this verbatim, so an uploaded vkey
 * MUST be hashed here or the pool registers with a wrong VRF and stops minting.
 */
export function useVrfImport() {
  async function hashVrfVkey(cborHex: string): Promise<string> {
    const keyHex = cborHex.startsWith('5820') ? cborHex.slice(4) : cborHex;
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('invalidVrfKeyFile');
    const rawVkey = new Uint8Array(keyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    const blake2b = (await import('blake2b')).default;
    const digest = blake2b(32).update(rawVkey).digest();
    return Array.from(digest as Uint8Array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function parseVrfFile(file: File): Promise<string> {
    let cborHex: string | undefined;
    try {
      const envelope = JSON.parse(await file.text());
      cborHex = envelope?.cborHex;
    } catch {
      throw new Error('invalidVrfKeyFile');
    }
    if (!cborHex) throw new Error('invalidVrfKeyFile');
    return hashVrfVkey(cborHex);
  }

  async function fetchVrfFromChain(
    poolId: string,
    chain: string,
    network: string,
  ): Promise<string | null> {
    try {
      const data = await blockchainApi.getPoolById(poolId, chain, network);
      const hash = data?.vrf_key_hash;
      return hash && /^[0-9a-f]{64}$/i.test(hash) ? hash : null;
    } catch {
      return null;
    }
  }

  async function saveVrf(hashHex: string): Promise<void> {
    poolOperatorStore.vrfKeyHash = hashHex;
    const walletId = walletStore.loggedWallet?.id;
    if (walletId) {
      const { setWalletConfiguration } = await import('@/db/wallet-db');
      await setWalletConfiguration(walletId, 'spo_vrfKeyHash', hashHex);
    }
  }

  return { hashVrfVkey, parseVrfFile, fetchVrfFromChain, saveVrf };
}
