import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => http, isAxiosError: () => false } }));
import { getHelpUpdates } from './help.api';

beforeEach(() => { http.get.mockReset().mockResolvedValue({ data: { items: [], total: 0, nextCursor: null, sources: [] } }); });
describe('getHelpUpdates', () => {
  it('asks for 20 items unless told otherwise', async () => {
    await getHelpUpdates({ source: 'all', chain: 'all', locale: 'en-US' }, new AbortController().signal);
    expect(http.get).toHaveBeenCalledWith('/api/help/updates', expect.objectContaining({ params: { source: 'all', chain: 'all', locale: 'en-US', limit: 20 } }));
  });
  it('forwards a smaller limit for the home cards and keeps the cursor', async () => {
    await getHelpUpdates({ source: 'gero-x', chain: 'cardano', locale: 'de-DE', cursor: 'next', limit: 1 }, new AbortController().signal);
    expect(http.get.mock.calls[0][1].params).toEqual({ source: 'gero-x', chain: 'cardano', locale: 'de-DE', cursor: 'next', limit: 1 });
  });
});
