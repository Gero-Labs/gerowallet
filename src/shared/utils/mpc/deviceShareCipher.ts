import { Buffer } from 'buffer';
import { encrypt as pwEncrypt, decrypt as pwDecrypt } from '@/shared/utils/crypto';

const PW_TAG = 'pw.v1';
const PRF_TAG = 'prf.v1';

export type DeviceShareSecret =
  | { kind: 'password'; password: string }
  | { kind: 'prf'; prfOutput: Uint8Array; credentialId: string; saltId: string };

/** HKDF(prfOutput) -> non-extractable AES-GCM-256, domain-separated for MPC device shares. */
async function prfAesKey(prfOutput: Uint8Array, saltId: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    prfOutput as Uint8Array<ArrayBuffer>,
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new Uint8Array(),
      hash: 'SHA-512',
      info: new TextEncoder().encode(`gero-mpc-deviceshare-encryption-v1:${saltId}`),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptDeviceShare(deviceShare: string, secret: DeviceShareSecret): Promise<string> {
  if (secret.kind === 'password') {
    return `${PW_TAG}:${pwEncrypt(deviceShare, secret.password)}`;
  }
  const key = await prfAesKey(secret.prfOutput, secret.saltId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(secret.credentialId) },
    key,
    new TextEncoder().encode(deviceShare),
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return `${PRF_TAG}:${Buffer.from(out).toString('hex')}`;
}

export async function decryptDeviceShare(envelope: string, secret: DeviceShareSecret): Promise<string> {
  const sep = envelope.indexOf(':');
  const tag = sep > 0 ? envelope.slice(0, sep) : '';
  const body = sep > 0 ? envelope.slice(sep + 1) : envelope;

  if (tag === PRF_TAG) {
    if (secret.kind !== 'prf') throw new Error('PRF device share requires a passkey');
    const raw = Buffer.from(body, 'hex');
    const iv = raw.subarray(0, 12);
    const ct = raw.subarray(12);
    const key = await prfAesKey(secret.prfOutput, secret.saltId);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(secret.credentialId) },
      key,
      ct,
    );
    return new TextDecoder().decode(pt);
  }

  // pw.v1 tag, or a legacy untagged blob — both are password AEAD from crypto.decrypt.
  if (tag === PW_TAG || sep < 0) {
    if (secret.kind !== 'password') throw new Error('Password device share requires a spending password');
    return pwDecrypt(body, secret.password);
  }

  throw new Error(`Unknown device-share envelope tag: ${tag}`);
}
