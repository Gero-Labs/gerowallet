import { Buffer } from 'buffer';
import { SecretPurpose, decrypt as pwDecrypt } from '@/shared/utils/crypto';
import { resealTextSecret } from '@/shared/utils/secretWriters';
import { isLegacySecret } from '@/shared/utils/passwordSecret';
import { isGpw2 } from '@/shared/utils/secretEnvelope';

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

/** Split an envelope into its tag ('' for a legacy untagged blob) and body. */
function splitEnvelope(envelope: string): { tag: string; body: string; tagged: boolean } {
  const sep = envelope.indexOf(':');
  return sep > 0
    ? { tag: envelope.slice(0, sep), body: envelope.slice(sep + 1), tagged: true }
    : { tag: '', body: envelope, tagged: false };
}

/**
 * Encrypt a device share. `replaces` is the envelope this one takes the place of
 * (a re-split, a format upgrade): a password share is then never sealed in a
 * weaker format than the one it replaces.
 */
export async function encryptDeviceShare(deviceShare: string, secret: DeviceShareSecret, replaces?: string): Promise<string> {
  if (secret.kind === 'password') {
    const previous = replaces ? splitEnvelope(replaces) : null;
    const previousBody = previous && previous.tag !== PRF_TAG ? previous.body : undefined;
    return `${PW_TAG}:${await resealTextSecret(deviceShare, secret.password, SecretPurpose.MpcShare, previousBody)}`;
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

/**
 * True when a password-encrypted device share is stored in a format older than
 * the current writer: a legacy (CryptoJS) blob, tagged or not, or, with
 * `envelopeV2` on, anything short of `gpw2`. PRF shares are never upgraded here.
 */
export function deviceShareNeedsUpgrade(envelope: string, envelopeV2: boolean): boolean {
  const { tag, body, tagged } = splitEnvelope(envelope);
  if (tagged && tag !== PW_TAG) return false;
  if (isGpw2(body)) return false;
  if (!isLegacySecret(body)) return envelopeV2; // gpw1
  return true;
}

export async function decryptDeviceShare(envelope: string, secret: DeviceShareSecret): Promise<string> {
  const { tag, body, tagged } = splitEnvelope(envelope);

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
  if (tag === PW_TAG || !tagged) {
    if (secret.kind !== 'password') throw new Error('Password device share requires a spending password');
    return pwDecrypt(body, secret.password, SecretPurpose.MpcShare);
  }

  throw new Error(`Unknown device-share envelope tag: ${tag}`);
}
