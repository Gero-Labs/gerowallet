import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getWriteStatus: mocks.status }) }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

import { assertMidnightWritesOpen, refreshMidnightWriteStatus, resetMidnightWriteStatusForTests } from './midnightWriteStatus';
import { isMidnightNetworkUpgrading, noteMidnightNetworkUpgrading, resetMidnightWriteGateForTests } from './midnightWriteGate';

beforeEach(() => {
  resetMidnightWriteGateForTests();
  resetMidnightWriteStatusForTests();
  mocks.status.mockReset();
});

describe('the status read', () => {
  it('turns the state on for writesOpen: false with reason NETWORK_UPGRADING (or no reason)', async () => {
    mocks.status.mockResolvedValue({ kind: 'closed', reason: 'NETWORK_UPGRADING' });
    await refreshMidnightWriteStatus('Mainnet', { force: true });
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(true);
    mocks.status.mockResolvedValue({ kind: 'closed' });
    await refreshMidnightWriteStatus('Preprod', { force: true });
    await expect(isMidnightNetworkUpgrading('Preprod')).resolves.toBe(true);
  });

  it('turns it off when writes reopen', async () => {
    await noteMidnightNetworkUpgrading('Mainnet', 'response');
    mocks.status.mockResolvedValue({ kind: 'open' });
    await refreshMidnightWriteStatus('Mainnet', { force: true });
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(false);
  });

  it('leaves a closure for another reason to its own state', async () => {
    mocks.status.mockResolvedValue({ kind: 'closed', reason: 'CLIENT_UPDATE_REQUIRED' });
    await refreshMidnightWriteStatus('Mainnet', { force: true });
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(false);
  });

  it.each([
    ['an unknown answer', () => mocks.status.mockResolvedValue({ kind: 'unknown', unsupported: false })],
    ['a throwing read', () => mocks.status.mockRejectedValue(new Error('down'))],
  ])('never turns the state on by itself (%s)', async (_name, arrange) => {
    arrange();
    await refreshMidnightWriteStatus('Mainnet', { force: true });
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(false);
  });

  it('does not ask a server without the route again', async () => {
    mocks.status.mockResolvedValue({ kind: 'unknown', unsupported: true });
    await refreshMidnightWriteStatus('Mainnet', { force: true });
    await refreshMidnightWriteStatus('Mainnet', { force: true });
    expect(mocks.status).toHaveBeenCalledTimes(1);
  });

  it('reuses a read from the last 30 s unless forced', async () => {
    mocks.status.mockResolvedValue({ kind: 'open' });
    await refreshMidnightWriteStatus('Mainnet');
    await refreshMidnightWriteStatus('Mainnet');
    expect(mocks.status).toHaveBeenCalledTimes(1);
    await refreshMidnightWriteStatus('Mainnet', { force: true });
    expect(mocks.status).toHaveBeenCalledTimes(2);
  });
});

describe('assertMidnightWritesOpen', () => {
  it('throws the readable network upgrade error on a paused network only', async () => {
    await noteMidnightNetworkUpgrading('Preprod', 'response');
    await expect(assertMidnightWritesOpen('Preprod')).rejects.toMatchObject({ name: 'MidnightApiError', kind: 'networkUpgrading', network: 'Preprod' });
    await expect(assertMidnightWritesOpen('Mainnet')).resolves.toBeUndefined();
  });

  it('with refresh, asks the server first', async () => {
    mocks.status.mockResolvedValue({ kind: 'closed', reason: 'NETWORK_UPGRADING' });
    await expect(assertMidnightWritesOpen('Mainnet', { refresh: true })).rejects.toMatchObject({ kind: 'networkUpgrading' });
    expect(mocks.status).toHaveBeenCalledTimes(1);
  });
});
