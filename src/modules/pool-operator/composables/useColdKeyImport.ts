import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

/**
 * Cold-key import for pool setup.
 *
 * The pool ID is the bech32 `pool`-prefixed blake2b-224 hash of the cold key's
 * ed25519 public key — the same value `cardano-cli` derives and the value
 * pool-info APIs return as the pool identifier. Extracted from
 * ImportColdKeyDialog.vue so the parse/derive/save logic is testable in
 * isolation from the dialog UI.
 */
export function useColdKeyImport() {
  const { t } = useTranslation();

  function parseColdKey(text: string): { type: string; rawKeyBytes: Uint8Array } {
    const envelope = JSON.parse(text);
    if (!envelope.type || !envelope.cborHex) {
      throw new Error('Not a valid Cardano key file (TextEnvelope format expected)');
    }
    if (!envelope.type.includes('StakePoolSigningKey') && !envelope.type.includes('Node')) {
      throw new Error(`Unexpected key type: ${envelope.type}. Expected StakePoolSigningKey.`);
    }
    const hex = envelope.cborHex;
    let keyHex: string;
    if (hex.startsWith('5820')) {
      keyHex = hex.slice(4);
    } else if (hex.startsWith('58')) {
      const lenByte = parseInt(hex.slice(2, 4), 16);
      keyHex = hex.slice(4, 4 + lenByte * 2);
    } else {
      keyHex = hex;
    }
    const rawKeyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    return { type: envelope.type, rawKeyBytes };
  }

  async function derivePoolId(keyBytes: Uint8Array) {
    const { ed25519 } = await import('@noble/curves/ed25519');
    const pubKey = ed25519.getPublicKey(keyBytes);
    const blake2b = (await import('blake2b')).default;
    const keyHashBytes = blake2b(28).update(pubKey).digest();
    const coldKeyHash = Array.from(keyHashBytes as Uint8Array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const { bech32 } = await import('bech32');
    const poolIdBech32 = bech32.encode('pool', bech32.toWords(keyHashBytes));
    return { coldKeyHash, poolIdBech32 };
  }

  async function saveColdKey(
    encrypted: string,
    coldKeyHash: string,
    poolIdBech32: string,
    encryptionMethod: 'password' | 'prf',
    credentialId?: string,
  ) {
    const walletId = walletStore.loggedWallet?.id;
    if (!walletId) throw new Error('No wallet logged in');
    const { setWalletConfiguration } = await import('@/db/wallet-db');
    await setWalletConfiguration(walletId, 'spo_encryptedColdKey', encrypted);
    await setWalletConfiguration(walletId, 'spo_coldKeyHash', coldKeyHash);
    await setWalletConfiguration(walletId, 'spo_coldKeySource', 'imported');
    await setWalletConfiguration(walletId, 'spo_poolId', poolIdBech32);
    await setWalletConfiguration(walletId, 'spo_coldKeyEncryption', encryptionMethod);
    if (credentialId) {
      await setWalletConfiguration(walletId, 'spo_coldKeyCredentialId', credentialId);
    }
    poolOperatorStore.coldKeySource = 'imported';
    poolOperatorStore.coldKeyHash = coldKeyHash;
    poolOperatorStore.poolId = poolIdBech32;
  }

  async function importWithPassKey(rawKeyBytes: Uint8Array) {
    const wallet = walletStore.loggedWallet;
    if (!wallet) throw new Error('No wallet logged in');
    const { encryptPrivateKeyWithPrf, registerWebAuthnCredentialWithPrf } = await import(
      '@/shared/utils/webauthn-prf'
    );
    const registration = await registerWebAuthnCredentialWithPrf(
      `spo-${wallet.id}`,
      `${wallet.name || 'Gero Wallet'} - Pool Cold Key`,
    );
    const encrypted = await encryptPrivateKeyWithPrf(
      rawKeyBytes,
      registration.credentialId,
      wallet.id.toString(),
      registration.prfOutput || undefined,
    );
    const { coldKeyHash, poolIdBech32 } = await derivePoolId(rawKeyBytes);
    await saveColdKey(encrypted, coldKeyHash, poolIdBech32, 'prf', registration.credentialId);
    return { coldKeyHash, poolId: poolIdBech32 };
  }

  async function importWithPassword(rawKeyBytes: Uint8Array, password: string, isNormalWallet: boolean) {
    if (isNormalWallet) {
      const verification = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password },
      })) as { data: { success: boolean; error?: string } };
      if (!verification.data.success) throw new Error(t('errors.wrongPassword'));
    }
    const { encryptWithPassword } = await import('@/shared/utils/crypto');
    const encrypted = encryptWithPassword(password, rawKeyBytes);
    const { coldKeyHash, poolIdBech32 } = await derivePoolId(rawKeyBytes);
    await saveColdKey(encrypted, coldKeyHash, poolIdBech32, 'password');
    return { coldKeyHash, poolId: poolIdBech32 };
  }

  return { parseColdKey, derivePoolId, importWithPassKey, importWithPassword };
}
