import { describe, expect, it, vi } from 'vitest';
import { endProviderSession } from './cardSession';

describe('endProviderSession', () => {
  it('logs out first (needs the live token), then revokes the token', async () => {
    const calls: string[] = [];
    const http = {
      get: vi.fn(async (url: string) => { calls.push(`GET ${url}`); }),
      post: vi.fn(async (url: string) => { calls.push(`POST ${url}`); }),
    };
    await endProviderSession(http);
    expect(calls).toEqual(['GET /api/kaiserex/logout', 'POST /api/kaiserex/revoke-token']);
  });

  it('still revokes when logout fails, and never throws', async () => {
    const http = {
      get: vi.fn().mockRejectedValue(new Error('500')),
      post: vi.fn().mockRejectedValue(new Error('404 on an older backend')),
    };
    await expect(endProviderSession(http)).resolves.toBeUndefined();
    expect(http.post).toHaveBeenCalledWith('/api/kaiserex/revoke-token');
  });
});
