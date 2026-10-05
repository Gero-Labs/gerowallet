import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleCardApiError } from './cardApiErrors';

describe('handleCardApiError', () => {
  it('expires the session on 401 and rethrows the original error', async () => {
    const expire = vi.fn().mockResolvedValue(undefined);
    const error = { response: { status: 401 } };
    await expect(handleCardApiError(error, expire)).rejects.toBe(error);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('leaves the session alone for every other failure', async () => {
    const expire = vi.fn();
    for (const error of [{ response: { status: 500 } }, { response: { status: 404 } }, new Error('network')]) {
      await expect(handleCardApiError(error, expire)).rejects.toBe(error);
    }
    expect(expire).not.toHaveBeenCalled();
  });
});

describe('card store wiring', () => {
  const store = readFileSync(join(__dirname, 'card.ts'), 'utf8');

  it('no longer calls the refresh route that exists nowhere', () => {
    expect(store).not.toContain('/api/token/refresh');
  });

  it('routes response errors through handleCardApiError', () => {
    expect(store).toContain('handleCardApiError(error, expireCardSession)');
  });
});
