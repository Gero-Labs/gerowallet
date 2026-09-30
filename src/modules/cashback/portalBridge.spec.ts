import { describe, it, expect } from 'vitest';
import {
  isTrustedPortalMessage,
  sessionUpdateMessage,
  signatureMessage,
  abortSignMessage,
  signRequestMessage,
  signPayloadHex,
  MAX_SIGN_MESSAGE_LENGTH,
} from './portalBridge';

const ORIGIN = 'https://portal.bringweb3.io';
const evt = (origin: string, data: unknown) => ({ origin, data } as MessageEvent);

describe('isTrustedPortalMessage', () => {
  it('accepts a bringweb3 message from the portal origin with an action', () => {
    expect(isTrustedPortalMessage(evt(ORIGIN, { from: 'bringweb3', action: 'LOGIN' }), ORIGIN)).toBe(true);
  });
  it('rejects a wrong origin', () => {
    expect(isTrustedPortalMessage(evt('https://evil.example', { from: 'bringweb3', action: 'LOGIN' }), ORIGIN)).toBe(false);
  });
  it('rejects a non-bringweb3 sender', () => {
    expect(isTrustedPortalMessage(evt(ORIGIN, { from: 'someoneelse', action: 'LOGIN' }), ORIGIN)).toBe(false);
  });
  it('rejects a message with no action', () => {
    expect(isTrustedPortalMessage(evt(ORIGIN, { from: 'bringweb3' }), ORIGIN)).toBe(false);
  });
  it('rejects null/undefined data', () => {
    expect(isTrustedPortalMessage(evt(ORIGIN, null), ORIGIN)).toBe(false);
  });
});

describe('outbound builders', () => {
  it('builds SESSION_UPDATE', () => {
    expect(sessionUpdateMessage('tok')).toEqual({ to: 'bringweb3', action: 'SESSION_UPDATE', token: 'tok' });
  });
  it('builds SIGNATURE', () => {
    expect(signatureMessage('sig', 'k', 'msg')).toEqual({ to: 'bringweb3', action: 'SIGNATURE', signature: 'sig', key: 'k', message: 'msg' });
  });
  it('builds ABORT_SIGN_MESSAGE', () => {
    expect(abortSignMessage()).toEqual({ to: 'bringweb3', action: 'ABORT_SIGN_MESSAGE' });
  });
});

describe('signRequestMessage', () => {
  it('returns the challenge of a well-formed request', () => {
    expect(signRequestMessage({ from: 'bringweb3', action: 'SIGN_MESSAGE', messageToSign: 'Claim 12.5 ADA nonce 42' })).toBe('Claim 12.5 ADA nonce 42');
  });
  it.each([
    ['no challenge', {}],
    ['a non-string challenge', { messageToSign: 42 }],
    ['an empty challenge', { messageToSign: '' }],
    ['an oversized challenge', { messageToSign: 'a'.repeat(MAX_SIGN_MESSAGE_LENGTH + 1) }],
    ['a control character', { messageToSign: 'claim\u0000hidden' }],
    ['null data', null],
  ])('refuses %s', (_name, data) => {
    expect(signRequestMessage(data)).toBeNull();
  });
  it('keeps line breaks, which the prompt renders', () => {
    expect(signRequestMessage({ messageToSign: 'Claim 1 ADA\nNonce: 42' })).toBe('Claim 1 ADA\nNonce: 42');
  });
  it('accepts a challenge at the length limit', () => {
    expect(signRequestMessage({ messageToSign: 'a'.repeat(MAX_SIGN_MESSAGE_LENGTH) })).toHaveLength(MAX_SIGN_MESSAGE_LENGTH);
  });
});

describe('signPayloadHex', () => {
  it('hex-encodes the UTF-8 bytes, not UTF-16 code units', () => {
    expect(signPayloadHex('Claim 1 ADA')).toBe('436c61696d203120414441');
    expect(signPayloadHex('€')).toBe('e282ac');
  });
});
