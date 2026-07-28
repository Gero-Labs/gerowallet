import { ref } from 'vue';
import { ed25519 } from '@noble/curves/ed25519';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const bytesToHex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Ephemeral, in-memory software payment key used ONLY to witness the fee input
 * of a Ledger pool-update tx (the Ledger owner cannot witness payment inputs in
 * POOL_REGISTRATION_AS_OWNER mode). Never persisted, never logged; reset after use.
 */
export function useHotFeeKey(networkId: 0 | 1) {
  const priv = ref<Uint8Array | null>(null);
  const hasKey = ref(false);

  async function generate(seedOverride?: Uint8Array) {
    if (priv.value) priv.value.fill(0);
    const seed = seedOverride ? Uint8Array.from(seedOverride) : crypto.getRandomValues(new Uint8Array(32));
    priv.value = seed;
    hasKey.value = true;
    const pub = ed25519.getPublicKey(seed);
    const publicKeyHex = bytesToHex(pub);

    const blake2b = (await import('blake2b')).default;
    const keyHash = blake2b(28).update(pub).digest();

    const enterpriseAddress = Cardano.EnterpriseAddress.fromCredentials(
      networkId === 1 ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet,
      { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(bytesToHex(keyHash)) },
    ).toAddress().toBech32();

    return { publicKeyHex, enterpriseAddress };
  }

  function signBodyHash(txBodyHashHex: string) {
    if (!priv.value) throw new Error('hot fee key not generated');
    const sig = ed25519.sign(hexToBytes(txBodyHashHex), priv.value);
    return { vkey: bytesToHex(ed25519.getPublicKey(priv.value)), signature: bytesToHex(sig) };
  }

  function reset() {
    if (priv.value) priv.value.fill(0);
    priv.value = null;
    hasKey.value = false;
  }

  return { generate, signBodyHash, reset, hasKey };
}
