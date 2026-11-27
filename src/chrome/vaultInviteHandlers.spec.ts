// The GeroVault invitation requests: one answer per request on every path, the credential read
// from the request and nothing else, every request extension-page-only, and each registered in
// the worker.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { EXTENSION_PAGE_ONLY_METHODS, isOptionsSenderAllowed } from './senderTrust';
import { VAULT_INVITE_MESSAGES } from './vaultInviteMessages';
import { VAULT_INVITE_ROUTES, authOf, vaultInviteHandler } from './vaultInviteHandlers';
import { InviteServiceError, type InviteService } from '@/services/vaultInvites/inviteService';

describe('vault invite handlers', () => {
  it('answers once with the result, or once with the code and details', async () => {
    const service = {
      status: vi.fn(async () => ({ inviteKey: 'ab' })),
      startSetup: vi.fn(async () => { throw new InviteServiceError('TOO_MANY_PENDING', { open: [{ setupId: 'x' }] }); }),
      accept: vi.fn(async () => { throw new Error('unexpected'); }),
    } as unknown as InviteService;
    const send = vi.fn();
    await vaultInviteHandler('GEROVAULT_INVITE_STATUS', async () => service)({ id: 1 }, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].data).toEqual({ success: true, result: { inviteKey: 'ab' } });

    send.mockClear();
    await vaultInviteHandler('GEROVAULT_SETUP_START', async () => service)({ id: 2, data: { password: 'p' } }, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].data).toEqual({ success: false, error: 'TOO_MANY_PENDING', details: { open: [{ setupId: 'x' }] } });

    send.mockClear();
    await vaultInviteHandler('GEROVAULT_INVITE_ACCEPT', async () => service)({ id: 3 }, send);
    expect(send.mock.calls[0][0].data).toEqual({ success: false, error: 'SERVER' });
  });

  it('reads a password or PassKey root key bytes, and nothing malformed', () => {
    expect(authOf({ password: 'p' })).toEqual({ password: 'p' });
    expect(authOf({ privateKeyBytes: [1, 2, 3] }).privateKeyBytes).toEqual(Uint8Array.from([1, 2, 3]));
    expect(authOf({ privateKeyBytes: [1, 300] })).toEqual({});
    expect(authOf({ password: 7 })).toEqual({});
  });

  it('has a route for every message, all extension-page-only and registered in the worker', () => {
    expect(Object.keys(VAULT_INVITE_ROUTES).sort()).toEqual([...VAULT_INVITE_MESSAGES].sort());
    for (const method of VAULT_INVITE_MESSAGES) {
      expect(EXTENSION_PAGE_ONLY_METHODS.has(method)).toBe(true);
      // A content script (an http page's sender) is refused, even with the extension's own id.
      expect(isOptionsSenderAllowed(method, { id: 'ext', url: 'https://example.com/' } as chrome.runtime.MessageSender, { id: 'ext', root: 'chrome-extension://ext/' })).toBe(false);
    }
    const bg = readFileSync('src/chrome/background.ts', 'utf8');
    expect(bg).toContain('for (const method of VAULT_INVITE_MESSAGES) app.addToOptions(method, vaultInviteHandler(method, vaultInvites));');
  });
});
