import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MidnightErrorCode } from '@/chrome/config';
import {
  answerBalanceUnsealedTransaction,
  replyOnce,
  type BalanceUnsealedDeps,
  type ConnectorReply,
} from '@/chrome/midnightBalanceUnsealed';

// Issue 1619: an unexpected throw in balanceUnsealedTransaction's async part
// left the dapp's promise waiting forever. Every path must answer, once.

const apiError = (code: string, reason: string) => ({ type: 'DAppConnectorAPIError', code, reason, message: reason });
const FAILED = 'Failed to complete the balancing request';

function setup(overrides: Partial<BalanceUnsealedDeps> = {}, recordActivity = vi.fn()) {
  const sent: ConnectorReply[] = [];
  const reply = replyOnce((opts) => { sent.push(opts); });
  const deps: BalanceUnsealedDeps = {
    resolveLedger: vi.fn(async () => 9),
    validate: vi.fn(() => ({ ok: true as const, tx: 'aa', payFees: true as const })),
    loadWallet: vi.fn(async () => ({ ownUnshieldedAddress: 'mn_addr_test1own', recordActivity })),
    prompt: vi.fn(async () => ({ ok: true as const, contributions: [], payments: [] })),
    sameWalletStill: vi.fn(() => true),
    park: vi.fn(async () => ({ data: { tx: 'bb' } })),
    apiError,
    parseParkError: (err, code, reason) => apiError(code, err instanceof Error ? err.message : reason),
    ...overrides,
  };
  return { sent, run: () => answerBalanceUnsealedTransaction({ tx: 'aa', payFees: true }, reply, deps), recordActivity };
}

const internalError = { error: apiError(MidnightErrorCode.InternalError, FAILED) };

describe('balanceUnsealedTransaction always answers the dapp, exactly once', () => {
  it('a throwing prompt (e.g. the address codec) is one InternalError', async () => {
    const { sent, run } = setup({ prompt: vi.fn(async () => { throw new Error('codec failed'); }) });
    await run();
    expect(sent).toEqual([internalError]);
  });

  it('a failed store import is one InternalError', async () => {
    const { sent, run } = setup({ loadWallet: vi.fn(async () => { throw new Error('chunk load failed'); }) });
    await run();
    expect(sent).toEqual([internalError]);
  });

  it('a throwing validator is one InternalError', async () => {
    const { sent, run } = setup({ validate: vi.fn(() => { throw new Error('boom'); }) });
    await run();
    expect(sent).toEqual([internalError]);
  });

  it('a failed activity record before parking is one InternalError, and nothing is parked', async () => {
    const recordActivity = vi.fn(() => { throw new Error('store write failed'); });
    const park = vi.fn(async () => ({ data: { tx: 'bb' } }));
    const { sent, run } = setup({ park }, recordActivity);
    await run();
    expect(sent).toEqual([internalError]);
    expect(park).not.toHaveBeenCalled();
  });

  it('a built transaction is answered once even if recording it fails', async () => {
    const recordActivity = vi.fn((event: { type: string }) => {
      if (event.type === 'funding-done') throw new Error('store write failed');
    });
    const { sent, run } = setup({}, recordActivity);
    await run();
    expect(sent).toEqual([{ data: { tx: 'bb' } }]);
  });

  it('a declined prompt keeps its own error even if recording the failure throws', async () => {
    const rejected = apiError(MidnightErrorCode.Rejected, 'User declined the balancing request');
    const recordActivity = vi.fn((event: { type: string }) => {
      if (event.type === 'funding-failed') throw new Error('store write failed');
    });
    const { sent, run } = setup({
      park: vi.fn(async () => { throw new Error('declined'); }),
      parseParkError: () => rejected,
    }, recordActivity);
    await run();
    expect(sent).toEqual([{ error: rejected }]);
    expect(recordActivity).toHaveBeenCalledWith({ type: 'funding-failed', reason: 'declined' });
  });

  it('a refused request is still InvalidRequest, answered once', async () => {
    const { sent, run } = setup({ prompt: vi.fn(async () => ({ ok: false as const, reason: 'tx already spends from this wallet' })) });
    await run();
    expect(sent).toEqual([{ error: apiError(MidnightErrorCode.InvalidRequest, 'tx already spends from this wallet') }]);
  });

  it('a ledger the wallet could not read is InternalError, not the dapp\'s mistake', async () => {
    const reason = 'Could not read which ledger Midnight Preprod runs';
    const unread = { ok: false as const, reason, internal: true as const };
    const atValidation = setup({ validate: vi.fn(() => unread) });
    await atValidation.run();
    expect(atValidation.sent).toEqual([{ error: apiError(MidnightErrorCode.InternalError, reason) }]);
    const atPrompt = setup({ prompt: vi.fn(async () => unread) });
    await atPrompt.run();
    expect(atPrompt.sent).toEqual([{ error: apiError(MidnightErrorCode.InternalError, reason) }]);
  });

  it('a wallet that changed or locked during the checks is Disconnected, and nothing is parked or recorded', async () => {
    let same = true;
    const park = vi.fn(async () => ({ data: { tx: 'bb' } }));
    const { sent, run, recordActivity } = setup({
      park,
      // Switches while the summary is read, after every earlier step.
      prompt: vi.fn(async () => { same = false; return { ok: true as const, contributions: [], payments: [] }; }),
      sameWalletStill: () => same,
    });
    await run();
    expect(sent).toEqual([{ error: apiError(MidnightErrorCode.Disconnected, 'The active wallet changed or locked while the request was checked') }]);
    expect(park).not.toHaveBeenCalled();
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it('the happy path parks the summary and answers with the sealed tx', async () => {
    const park = vi.fn(async () => ({ data: { tx: 'bb' } }));
    const { sent, run, recordActivity } = setup({ park });
    await run();
    expect(park).toHaveBeenCalledWith({ tx: 'aa', contributions: [], payments: [] });
    expect(sent).toEqual([{ data: { tx: 'bb' } }]);
    expect(recordActivity.mock.calls.map(([event]) => event.type)).toEqual(['funding', 'funding-done']);
  });
});

describe('replyOnce', () => {
  it('forwards the first answer only', () => {
    const send = vi.fn();
    const reply = replyOnce(send);
    reply({ data: 1 });
    reply({ error: 'late' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ data: 1 });
  });
});

describe('the background handler uses it', () => {
  it('guards its reply and hands the async part to answerBalanceUnsealedTransaction', () => {
    const bg = readFileSync(join(__dirname, 'background.ts'), 'utf8').replace(/\r\n/g, '\n');
    const start = bg.indexOf('app.add(MIDNIGHT_METHOD.balanceUnsealedTransaction, ');
    expect(start).toBeGreaterThan(-1);
    const body = bg.slice(start, bg.indexOf('\napp.add(', start + 10));
    expect(body).toContain('const reply = replyOnce((opts: ReplyOpts) => {');
    expect(body).toContain('void answerBalanceUnsealedTransaction(data, reply, {');
    expect(body).not.toContain('void (async () => {');
    // Wallet, network, lock and site permission are all read again before the prompt is parked.
    expect(body).toContain('const { id: walletId, network: walletNetwork } = currentWallet;');
    expect(body).toMatch(/now\?\.id === walletId && now\.network === walletNetwork && !walletStore\.isLocked && WalletStore\.isWhitelisted\(origin\)/);
  });
});
