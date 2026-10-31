import { describe, expect, it } from 'vitest';
import { RESERVED_SIGNING_DOMAINS, reservedSigningDomain } from './reservedSigningDomains';
import { buildDeviceRegisterSubject, DEVICE_REGISTER_DOMAIN } from '@/services/crossDevice/registerProof';
import { buildSupportChallengeSubject, SUPPORT_CHALLENGE_DOMAIN } from '@/chrome/supportChatAuth';
import { CROSS_DEVICE_SUBJECT_VERSION } from '@/services/crossDevice/envelope';
import { PAIRING_QR_VERSION } from '@/services/crossDevice/pairingQr';
import { XPROVE_VERSION } from '@/services/crossDevice/proveSession';
import { NOTIFY_SIGNING_DOMAIN } from '@/services/notify/notifyAuth';
import { buildSessionSubject } from '@/services/crossDevice/sessionBinding';

const hex = (text: string) => Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('');

const STAKE = 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zctvm3rc';

describe('reservedSigningDomain', () => {
  it('covers every subject prefix Gero signs today', () => {
    for (const domain of [DEVICE_REGISTER_DOMAIN, SUPPORT_CHALLENGE_DOMAIN, CROSS_DEVICE_SUBJECT_VERSION, PAIRING_QR_VERSION, XPROVE_VERSION, NOTIFY_SIGNING_DOMAIN]) {
      expect(RESERVED_SIGNING_DOMAINS.some(prefix => domain.startsWith(prefix))).toBe(true);
      expect(reservedSigningDomain(hex(domain))).not.toBeNull();
    }
  });

  it('refuses the real proofs a dApp could try to get signed (CIP-30 hex payloads)', () => {
    const relayKey = 'a'.repeat(64);
    expect(reservedSigningDomain(hex(buildDeviceRegisterSubject('0123456789abcdef0123456789abcdef', relayKey, STAKE)))).toBe('gero-xdev/');
    expect(reservedSigningDomain(hex(buildSupportChallengeSubject(STAKE, 'AbCdEfGhIjKlMnOpQr')))).toBe('gero-support/');
    expect(reservedSigningDomain(hex(buildSessionSubject('c'.repeat(32), 'd'.repeat(32), 'mainnet', STAKE)))).toBe('gero-xdev/');
  });

  it('refuses them as plain text, in upper case, and with a 0x prefix', () => {
    expect(reservedSigningDomain(`${SUPPORT_CHALLENGE_DOMAIN}|${STAKE}|nonce`)).toBe('gero-support/');
    expect(reservedSigningDomain(hex('GERO-XDEV/v1|DEVICE_REGISTER|x'))).toBe('gero-xdev/');
    expect(reservedSigningDomain(`0x${hex('gero-notify/v1|GET|/x')}`)).toBe('gero-notify/');
  });

  it('refuses a future gero-<name>/v<N> subject', () => {
    expect(reservedSigningDomain(hex('gero-vault/v2|UNLOCK|abc'))).toBe('gero-vault/v2');
    expect(reservedSigningDomain(hex('gero-vault/v2'))).toBe('gero-vault/v2');
  });

  it('lets ordinary messages through', () => {
    for (const payload of [
      hex('Sign in to example.com\nNonce: 1234'),
      hex('gero is great'),
      hex('gero-xdevil'),
      hex('gero-vault/version'),
      hex('My gero-xdev/v1 note'),
      'deadbeef',
      'a5010102',
      '',
      undefined,
      42,
    ]) {
      expect(reservedSigningDomain(payload)).toBeNull();
    }
  });
});
