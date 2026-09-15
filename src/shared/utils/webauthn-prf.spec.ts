// Where the browser is told to look for a PassKey.
//
// `allowCredentials[].transports` is what tells Chrome a credential lives on
// THIS device. Given `["internal"]` it opens Windows Hello; given nothing it
// cannot know, so it offers every route it supports — phone, security key, this
// device — and a Windows Hello user is asked to pick from a list that mostly
// does not apply to them. That was the reported bug.
//
// The rule these cases exist to protect is the other half: nothing is ever
// GUESSED. Asserting `internal` for a credential that actually lives on a
// security key points Chrome at a device the key is not in, and a PRF wallet has
// no password to fall back on — that is a signing lockout, not a worse prompt.
import { describe, it, expect } from 'vitest';
import { allowCredentialFor, readTransports } from './webauthn-prf';

/** A base64 credential id; the value is irrelevant, only that it round-trips. */
const CREDENTIAL_ID = 'Y3JlZGVudGlhbC1pZC1ieXRlcw==';

describe('allowCredentialFor', () => {
  it('names the transport when it is known, so the right authenticator opens', () => {
    const descriptor = allowCredentialFor(CREDENTIAL_ID, ['internal']);
    expect(descriptor.transports).toEqual(['internal']);
    expect(descriptor.type).toBe('public-key');
    expect(descriptor.id.byteLength).toBeGreaterThan(0);
  });

  it('passes through whatever was recorded, not just internal', () => {
    // A deliberately registered security key must keep pointing at usb.
    expect(allowCredentialFor(CREDENTIAL_ID, ['usb', 'nfc']).transports).toEqual(['usb', 'nfc']);
    expect(allowCredentialFor(CREDENTIAL_ID, ['hybrid']).transports).toEqual(['hybrid']);
  });

  it('omits transports entirely when nothing is known', () => {
    // The picker, which is inconvenient but always works. The alternative is
    // guessing, and a wrong guess cannot be recovered from without a password.
    for (const unknown of [undefined, null, [] as const]) {
      const descriptor = allowCredentialFor(CREDENTIAL_ID, unknown);
      expect(descriptor).not.toHaveProperty('transports');
    }
  });

  it('copies the array rather than aliasing the stored one', () => {
    const stored: AuthenticatorTransport[] = ['internal'];
    const descriptor = allowCredentialFor(CREDENTIAL_ID, stored);
    expect(descriptor.transports).not.toBe(stored);
    expect(descriptor.transports).toEqual(stored);
  });
});

describe('readTransports', () => {
  /** A registration response that reports `transports`, as the real one does. */
  const credentialWith = (getTransports: unknown) =>
    ({ response: getTransports === undefined ? {} : { getTransports } }) as unknown as PublicKeyCredential;

  it('reads what the authenticator reported', () => {
    expect(readTransports(credentialWith(() => ['internal']))).toEqual(['internal']);
    expect(readTransports(credentialWith(() => ['usb', 'nfc']))).toEqual(['usb', 'nfc']);
  });

  it('is null when the browser reported nothing usable', () => {
    // Older browsers have no getTransports at all; some return an empty list.
    // Both mean "not known", which must never become a constraint.
    expect(readTransports(credentialWith(undefined))).toBeNull();
    expect(readTransports(credentialWith(() => []))).toBeNull();
    expect(readTransports(credentialWith(() => null))).toBeNull();
  });

  it('survives an authenticator that throws instead of answering', () => {
    expect(
      readTransports(
        credentialWith(() => {
          throw new Error('not implemented');
        }),
      ),
    ).toBeNull();
  });
});
