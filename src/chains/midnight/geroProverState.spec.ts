// Gero Prover as the pages see it: what a send is told before it starts, and
// how a helper failure from the background is said to the user.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ reply: undefined as unknown, requests: [] as unknown[] }));

vi.mock('@/chrome/messaging', () => ({
  Messaging: {
    sendToBackgroundFromOptions: vi.fn(async (request: unknown) => {
      sent.requests.push(request);
      if (sent.reply instanceof Error) throw sent.reply;
      return sent.reply;
    }),
  },
}));

import {
  askGeroProver,
  geroProverSnapshot,
  HELPER_ERROR_COPY,
  HELPER_UNAVAILABLE_REASON,
  helperErrorCopyKey,
  helperPreflightReason,
  helperProcessorLabel,
  isHelperUnavailableReason,
} from './geroProverState';
import {
  GERO_PROVER_CLOSED,
  GERO_PROVER_FORBIDDEN,
  GERO_PROVER_KEYS,
  GERO_PROVER_NOT_ALLOWED,
  GERO_PROVER_NOT_FOUND,
  GERO_PROVER_PROOF_FAILED,
  GERO_PROVER_TIMEOUT,
  GERO_PROVER_UNSUPPORTED_CIRCUIT,
  GERO_PROVER_WRONG_VERSION,
  type HelperStatus,
} from './midnightHelperProtocol';

const status = (accelerator: Partial<HelperStatus['accelerator']>): HelperStatus => ({
  accelerator: { enabled: true, state: 'active', gpuOps: 0, cpuOps: 0, ...accelerator },
  keys: { files: 4, bytes: 3_750_000 },
  threads: 8,
});

function answer(snapshot: unknown, extra: Record<string, unknown> = {}) {
  sent.reply = { data: { success: true, result: { snapshot, ...extra } } };
}

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

beforeEach(() => {
  sent.requests = [];
  sent.reply = undefined;
  geroProverSnapshot.value = null;
});

describe('helperPreflightReason', () => {
  it('lets a send go when the helper is connected', async () => {
    answer({ connection: 'connected', version: '1.0.0', os: 'macos', status: status({}) });
    expect(await helperPreflightReason()).toBeUndefined();
    expect(sent.requests).toEqual([{ method: 'GERO_PROVER', data: { action: 'status' } }]);
    expect(geroProverSnapshot.value?.connection).toBe('connected');
  });

  it.each([
    ['not-allowed', 'helper-not-allowed'],
    ['not-found', 'helper-not-found'],
    ['forbidden', 'helper-not-found'],
    ['wrong-version', 'helper-wrong-version'],
    ['error', 'helper-error'],
  ])('names why it cannot: %s', async (connection, reason) => {
    answer({ connection });
    expect(await helperPreflightReason()).toBe(reason);
    expect(isHelperUnavailableReason(reason)).toBe(true);
  });

  it('reads an unreachable or refusing background as an error, never as connected', async () => {
    sent.reply = new Error('Extension context invalidated.');
    expect(await helperPreflightReason()).toBe('helper-error');
    sent.reply = { data: { success: false, error: 'nope' } };
    expect(await helperPreflightReason()).toBe('helper-error');
    // "connected" without a status is not believed.
    answer({ connection: 'connected' });
    expect(await helperPreflightReason()).toBe('helper-error');
  });
});

describe('askGeroProver', () => {
  it('returns the test proof result with the status read after it', async () => {
    answer({ connection: 'connected', status: status({}) }, { selfTest: { proveMs: 1180, accelerated: true } });
    const result = await askGeroProver({ action: 'selfTest' });
    expect(result.selfTest).toEqual({ proveMs: 1180, accelerated: true });
    expect(result.snapshot.connection).toBe('connected');
  });

  it('throws the background error text for a failed action', async () => {
    sent.reply = { data: { success: false, error: GERO_PROVER_PROOF_FAILED } };
    await expect(askGeroProver({ action: 'selfTest' })).rejects.toMatchObject({ name: 'GeroProverActionError', message: GERO_PROVER_PROOF_FAILED });
  });
});

describe('helper failures in the user language', () => {
  it('splits "cannot be used" from "the proof failed"', () => {
    // Cannot be used: the send dialog offers the other ways to prove.
    expect(Object.keys(HELPER_UNAVAILABLE_REASON).sort()).toEqual(
      [GERO_PROVER_FORBIDDEN, GERO_PROVER_NOT_ALLOWED, GERO_PROVER_NOT_FOUND, GERO_PROVER_WRONG_VERSION].sort(),
    );
    // Attempted and failed: one message, nothing else is tried.
    expect(Object.keys(HELPER_ERROR_COPY).sort()).toEqual(
      [GERO_PROVER_CLOSED, GERO_PROVER_KEYS, GERO_PROVER_PROOF_FAILED, GERO_PROVER_TIMEOUT, GERO_PROVER_UNSUPPORTED_CIRCUIT].sort(),
    );
  });

  it('gives every code a copy key and leaves other error text alone', () => {
    expect(helperErrorCopyKey(GERO_PROVER_TIMEOUT)).toBe('midnight.prover.error.timeout');
    expect(helperErrorCopyKey(GERO_PROVER_NOT_FOUND)).toBe('midnight.prover.error.unavailable');
    expect(helperErrorCopyKey('Insufficient Funds: could not balance dust')).toBeUndefined();
    expect(helperErrorCopyKey('toString')).toBeUndefined();
    expect(helperErrorCopyKey(undefined)).toBeUndefined();
  });
});

describe('helperProcessorLabel', () => {
  it('says nothing before the helper has been asked, or when it is not connected', () => {
    expect(helperProcessorLabel(t)).toBeUndefined();
    geroProverSnapshot.value = { connection: 'not-found' };
    expect(helperProcessorLabel(t)).toBeUndefined();
  });

  it('names the graphics processor only while it is in use', () => {
    geroProverSnapshot.value = { connection: 'connected', status: status({ device: 'Apple M3 Pro' }) };
    expect(helperProcessorLabel(t)).toBe('midnight.prover.gpuNamed:{"device":"Apple M3 Pro"}');
    geroProverSnapshot.value = { connection: 'connected', status: status({}) };
    expect(helperProcessorLabel(t)).toBe('midnight.prover.gpu');
    for (const state of ['off', 'no-device', 'unsupported', 'tripped'] as const) {
      geroProverSnapshot.value = { connection: 'connected', status: status({ state, device: 'Apple M3 Pro' }) };
      expect(helperProcessorLabel(t)).toBe('midnight.prover.cpu');
    }
  });
});
