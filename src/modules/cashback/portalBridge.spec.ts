import { describe, it, expect } from 'vitest';
import {
  isTrustedPortalMessage,
  sessionUpdateMessage,
  signatureMessage,
  abortSignMessage,
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
