import { describe, expect, it } from 'vitest';
import {
  asBuildStep, buildFailureOf, buildFailureReply, markBuildStep, MidnightBuildFailedError,
  NEXUS_INSUFFICIENT_FUNDS, readBuildFailure, withBuildFailure,
} from './midnightBuildFailure';
import { IntentInsufficientFundsError } from './midnightConnectorIntent';
import { MidnightErrorCode } from '@/chrome/config';

class FakeApiError extends Error {
  constructor(readonly errorCode: string) { super('Nexus said no'); }
}

describe('buildFailureOf', () => {
  it.each([
    ['the intent builder\'s shortfall', new IntentInsufficientFundsError()],
    ['the SDK\'s coin selection', Object.assign(new Error('x'), { _tag: 'Wallet.InsufficientFunds' })],
    ['the SDK\'s DUST shortfall', new Error('Insufficient Funds: could not balance dust')],
    ['Nexus\'s 422', new FakeApiError(NEXUS_INSUFFICIENT_FUNDS)],
  ])('%s is InsufficientFunds', (_name, error) => {
    expect(buildFailureOf(error)).toBe(MidnightErrorCode.InsufficientFunds);
  });

  it.each([
    ['a ledger refusal', new Error('MIDNIGHT_LEDGER_CHANGED')],
    ['another Nexus error', new FakeApiError('UPSTREAM_UNAVAILABLE')],
    ['a thrown string', 'boom'],
  ])('%s is InternalError', (_name, error) => {
    expect(buildFailureOf(error)).toBe(MidnightErrorCode.InternalError);
  });
});

describe('asBuildStep (worker)', () => {
  it('marks a failure and keeps its message for the page to translate', async () => {
    const error = await asBuildStep(() => Promise.reject(new Error('MIDNIGHT_LEDGER_UNKNOWN'))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MidnightBuildFailedError);
    expect((error as MidnightBuildFailedError).message).toBe('MIDNIGHT_LEDGER_UNKNOWN');
    expect(buildFailureReply(error)).toEqual({ buildFailure: 'InternalError' });
  });

  it('keeps an inner mark', async () => {
    const inner = new MidnightBuildFailedError('InsufficientFunds', 'short');
    await expect(asBuildStep(() => Promise.reject(inner))).rejects.toBe(inner);
  });

  it('passes a result through', async () => {
    await expect(asBuildStep(() => Promise.resolve(7))).resolves.toBe(7);
  });

  it('an unmarked error gets no buildFailure in the reply (a wrong password)', () => {
    expect(buildFailureReply(new Error('Wrong password'))).toEqual({});
  });
});

describe('the page side', () => {
  it('markBuildStep marks in place, so a Nexus error keeps its type', async () => {
    const error = await markBuildStep(() => Promise.reject(new FakeApiError(NEXUS_INSUFFICIENT_FUNDS))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FakeApiError);
    expect((error as { buildFailure?: string }).buildFailure).toBe('InsufficientFunds');
  });

  it('readBuildFailure takes only the two codes', () => {
    expect(readBuildFailure('InsufficientFunds')).toBe('InsufficientFunds');
    expect(readBuildFailure('InternalError')).toBe('InternalError');
    expect(readBuildFailure('Rejected')).toBeUndefined();
    expect(readBuildFailure(undefined)).toBeUndefined();
  });

  it('withBuildFailure puts a reply\'s mark on the error, and nothing for no mark', () => {
    expect((withBuildFailure(new Error('x'), 'InsufficientFunds') as { buildFailure?: string }).buildFailure).toBe('InsufficientFunds');
    expect('buildFailure' in withBuildFailure(new Error('x'), undefined)).toBe(false);
  });
});
