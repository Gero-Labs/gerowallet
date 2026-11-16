import { describe, expect, it, vi } from 'vitest';
import { isNewTopDocument, ParkedConnects, takeParkedRequests } from './midnightParkedPrompts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('ParkedConnects', () => {
  it('a repeated connect from the same tab and site joins the parked prompt', async () => {
    const connects = new ParkedConnects<string>();
    const prompt = deferred<string>();
    const park = vi.fn(() => prompt.promise);
    const answers = [1, 2, 3].map(() => connects.join(7, 'https://dapp.example', park));
    expect(park).toHaveBeenCalledTimes(1);
    prompt.resolve('approved');
    await expect(Promise.all(answers)).resolves.toEqual(['approved', 'approved', 'approved']);
  });

  it('another site or another tab gets its own prompt', () => {
    const connects = new ParkedConnects<string>();
    const park = vi.fn(() => new Promise<string>(() => undefined));
    connects.join(7, 'https://a.example', park);
    connects.join(7, 'https://b.example', park);
    connects.join(8, 'https://a.example', park);
    expect(park).toHaveBeenCalledTimes(3);
  });

  it('an answered prompt is forgotten, so the next connect asks again', async () => {
    const connects = new ParkedConnects<string>();
    const first = deferred<string>();
    const answer = connects.join(7, 'https://dapp.example', () => first.promise);
    first.reject(new Error('declined'));
    await expect(answer).rejects.toThrow('declined');
    expect(connects.size).toBe(0);
    const park = vi.fn(() => Promise.resolve('again'));
    await expect(connects.join(7, 'https://dapp.example', park)).resolves.toBe('again');
    expect(park).toHaveBeenCalledTimes(1);
  });

  it('forgetTab drops only that tab\'s prompts', () => {
    const connects = new ParkedConnects<string>();
    const never = () => new Promise<string>(() => undefined);
    connects.join(7, 'https://a.example', never);
    connects.join(71, 'https://a.example', never);
    connects.forgetTab(7);
    expect(connects.size).toBe(1);
  });

  it('a prompt that settles after its tab was forgotten does not remove a newer one', async () => {
    const connects = new ParkedConnects<string>();
    const old = deferred<string>();
    const oldAnswer = connects.join(7, 'https://dapp.example', () => old.promise);
    connects.forgetTab(7);
    connects.join(7, 'https://dapp.example', () => new Promise<string>(() => undefined));
    old.resolve('late');
    await oldAnswer;
    expect(connects.size).toBe(1);
  });
});

describe('takeParkedRequests', () => {
  it('removes and returns only that tab\'s entries for those methods', () => {
    const pending = new Map([
      ['r1', { tabId: 7, method: 'midnight_connect' }],
      ['r2', { tabId: 7, method: 'midnight_makeTransfer' }],
      ['r3', { tabId: 8, method: 'midnight_connect' }],
      ['r4', { tabId: 7, method: 'enable' }],
    ]);
    const taken = takeParkedRequests(pending, 7, new Set(['midnight_connect', 'midnight_makeTransfer']));
    expect(taken).toEqual([{ tabId: 7, method: 'midnight_connect' }, { tabId: 7, method: 'midnight_makeTransfer' }]);
    expect([...pending.keys()]).toEqual(['r3', 'r4']);
  });
});

describe('isNewTopDocument', () => {
  it.each([
    [{ frameId: 0 }, true],
    [{ frameId: 0, documentLifecycle: 'active' }, true],
    [{ frameId: 3 }, false],
    [{ frameId: 0, documentLifecycle: 'prerender' }, false],
  ])('%o → %s', (details, expected) => {
    expect(isNewTopDocument(details)).toBe(expected);
  });
});
