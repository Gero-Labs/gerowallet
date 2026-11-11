// "Update required" (issue 1468): the state, its triggers and its precedence over
// the network upgrade. The network upgrade's own behaviour is in
// midnightWriteGate.spec.ts and midnightWriteStatus.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getWriteStatus: mocks.status }) }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

import { assertMidnightWritesOpen, refreshMidnightWriteStatus, resetMidnightWriteStatusForTests, updateRequiredBy } from './midnightWriteStatus';
import {
  RESPONSE_GATE_TTL_MS, isMidnightNetworkUpgrading, midnightWriteBlock, nextGateRecord, noteMidnightNetworkUpgrading,
  noteMidnightUpdateRequired, noteMidnightWritesOpen, resetMidnightWriteGateForTests, writeBlockIn,
} from './midnightWriteGate';

let installed = '2.8.4';
beforeEach(() => {
  installed = '2.8.4';
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: installed }) } });
  resetMidnightWriteGateForTests();
  resetMidnightWriteStatusForTests();
  mocks.status.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const read = async (status: Record<string, unknown>, network = 'Mainnet') => {
  mocks.status.mockResolvedValue(status);
  await refreshMidnightWriteStatus(network, { force: true });
  return midnightWriteBlock(network);
};

describe('what turns "update required" on', () => {
  it('a status read whose minimum extension version is above this build, while writes are open', async () => {
    await expect(read({ kind: 'open', minExtensionVersion: '2.9.0' })).resolves.toBe('updateRequired');
    // Closed for the upgrade: the minimum is for the build that reopens, not a reason to update today.
    await expect(read({ kind: 'closed', reason: 'NETWORK_UPGRADING', minExtensionVersion: '2.9.0' }, 'Preprod')).resolves.toBe('networkUpgrading');
  });

  it('a status read whose ledger this build cannot sign for, while writes are open', async () => {
    // This build signs ledger 8 on Mainnet and Preprod, ledger 9 on Stagenet.
    await expect(read({ kind: 'open', ledger: 9 })).resolves.toBe('updateRequired');
    await expect(read({ kind: 'open', ledger: 9 }, 'Stagenet')).resolves.toBeNull();
    await expect(read({ kind: 'open', ledger: 8 }, 'Preprod')).resolves.toBeNull();
  });

  it('a closed status body (writesOpen false, NETWORK_UPGRADING, a ledger above this build) is the network upgrade', async () => {
    const { parseMidnightWriteStatus } = await vi.importActual<typeof import('@/api/midnight-api')>('@/api/midnight-api');
    const status = parseMidnightWriteStatus({ writesOpen: false, reason: 'NETWORK_UPGRADING', ledger: 9 });
    expect(status).toMatchObject({ kind: 'closed', reason: 'NETWORK_UPGRADING', ledger: 9 });
    await expect(read(status as Record<string, unknown>)).resolves.toBe('networkUpgrading');
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(true);
  });

  it('a status read with reason CLIENT_UPDATE_REQUIRED', async () => {
    await expect(read({ kind: 'closed', reason: 'CLIENT_UPDATE_REQUIRED' })).resolves.toBe('updateRequired');
    await expect(isMidnightNetworkUpgrading('Mainnet')).resolves.toBe(false);
  });

  it('a 501 whose reason says this build must update', async () => {
    await noteMidnightUpdateRequired('Mainnet', 'response');
    await expect(midnightWriteBlock('Mainnet')).resolves.toBe('updateRequired');
  });

  it('nothing, when the read names no minimum and no ledger, or this build meets them', async () => {
    await expect(read({ kind: 'open' })).resolves.toBeNull();
    await expect(read({ kind: 'open', minExtensionVersion: '2.8.4', ledger: 8 })).resolves.toBeNull();
    await expect(read({ kind: 'closed', reason: 'NETWORK_UPGRADING', minExtensionVersion: '2.8.0' })).resolves.toBe('networkUpgrading');
  });

  it('nothing from a version it cannot read, or a build whose version is unknown', () => {
    expect(updateRequiredBy({ kind: 'open', minExtensionVersion: 'soon' }, 'Mainnet')).toBeNull();
    expect(updateRequiredBy({ kind: 'open', minExtensionVersion: '9.0.0' }, 'Mainnet', '')).toBeNull();
    expect(updateRequiredBy({ kind: 'open', ledger: 9 }, 'Unknownnet')).toBeNull();
  });
});

describe('precedence over the network upgrade', () => {
  it('a 501 saying "update" raises a live status-read upgrade pause; a 501 saying "upgrading" never lowers "update"', async () => {
    await noteMidnightNetworkUpgrading('Mainnet', 'status');
    await noteMidnightUpdateRequired('Mainnet', 'response');
    await expect(midnightWriteBlock('Mainnet')).resolves.toBe('updateRequired');

    resetMidnightWriteGateForTests();
    await noteMidnightUpdateRequired('Mainnet', 'status', { minVersion: '2.9.0' });
    await noteMidnightNetworkUpgrading('Mainnet', 'response');
    await expect(midnightWriteBlock('Mainnet')).resolves.toBe('updateRequired');
  });

  it('the next status read decides', async () => {
    await noteMidnightUpdateRequired('Mainnet', 'response');
    await expect(read({ kind: 'closed', reason: 'NETWORK_UPGRADING' })).resolves.toBe('networkUpgrading');
    await expect(read({ kind: 'open' })).resolves.toBeNull();
  });
});

describe('what turns it off', () => {
  it('after the extension updates, the next status read', async () => {
    await expect(read({ kind: 'open', minExtensionVersion: '2.9.0' })).resolves.toBe('updateRequired');
    installed = '2.9.0';
    await expect(read({ kind: 'open', minExtensionVersion: '2.9.0' })).resolves.toBeNull();
  });

  it('a minimum this build now meets no longer holds it, even before that read', async () => {
    await read({ kind: 'open', minExtensionVersion: '2.9.0' });
    installed = '2.9.1';
    await expect(midnightWriteBlock('Mainnet')).resolves.toBeNull();
  });

  it('a reason or a ledger is not undone by the version alone', () => {
    const now = Date.now();
    const record = nextGateRecord({}, 'Mainnet', { paused: true, source: 'status', at: now, block: 'updateRequired' });
    expect(writeBlockIn(record, 'Mainnet', now, '99.0.0')).toBe('updateRequired');
  });

  it('a write that succeeds, and a remembered 501 after its time', async () => {
    await noteMidnightUpdateRequired('Mainnet', 'response');
    await noteMidnightWritesOpen('Mainnet');
    await expect(midnightWriteBlock('Mainnet')).resolves.toBeNull();

    const at = Date.now();
    const record = nextGateRecord({}, 'Mainnet', { paused: true, source: 'response', at, block: 'updateRequired' });
    expect(writeBlockIn(record, 'Mainnet', at + RESPONSE_GATE_TTL_MS - 1)).toBe('updateRequired');
    expect(writeBlockIn(record, 'Mainnet', at + RESPONSE_GATE_TTL_MS)).toBeNull();
  });

  it('is per network', async () => {
    await noteMidnightUpdateRequired('Mainnet', 'response');
    await expect(midnightWriteBlock('Preprod')).resolves.toBeNull();
  });
});

describe('status bodies as the server sends them (parsed, then read)', () => {
  // This build signs ledger 8 on Mainnet.
  const closedForUpgrade = { writesOpen: false, reason: 'NETWORK_UPGRADING', ledger: 9, minClientVersion: { extension: '9.0.0' } };
  const openClientUpdate = { writesOpen: true, reason: 'CLIENT_UPDATE_REQUIRED' };
  const openNewerLedger = { writesOpen: true, ledger: 9 };
  const openNewerLedgerName = { writesOpen: true, ledger: 'ledger-9' };
  const openSameLedger = { writesOpen: true, ledger: 8 };
  const feed = async (body: Record<string, unknown>) => {
    const { parseMidnightWriteStatus } = await vi.importActual<typeof import('@/api/midnight-api')>('@/api/midnight-api');
    return read(parseMidnightWriteStatus(body) as unknown as Record<string, unknown>);
  };

  it.each([
    ['closed for the upgrade, with a newer ledger and a minimum', closedForUpgrade, 'networkUpgrading'],
    ['open, reason CLIENT_UPDATE_REQUIRED', openClientUpdate, 'updateRequired'],
    ['open, a newer ledger', openNewerLedger, 'updateRequired'],
    ['open, a newer ledger by name', openNewerLedgerName, 'updateRequired'],
    ['open, the ledger this build signs', openSameLedger, null],
  ])('%s, from a clean gate', async (_name, body, expected) => {
    await expect(feed(body)).resolves.toBe(expected);
  });

  it('each read replaces the state the previous one set', async () => {
    await expect(feed(openNewerLedger)).resolves.toBe('updateRequired');
    await expect(feed(closedForUpgrade)).resolves.toBe('networkUpgrading');
    await expect(feed(openClientUpdate)).resolves.toBe('updateRequired');
    await expect(feed(openSameLedger)).resolves.toBeNull();
    await expect(feed(closedForUpgrade)).resolves.toBe('networkUpgrading');
    await expect(feed(openSameLedger)).resolves.toBeNull();
  });
});

describe('the send and registration paths', () => {
  it('stop with the update sentence before anything is asked for', async () => {
    await noteMidnightUpdateRequired('Mainnet', 'status', { minVersion: '2.9.0' });
    const refused = await assertMidnightWritesOpen('Mainnet').catch((e: unknown) => e);
    expect(refused).toMatchObject({ name: 'MidnightApiError', kind: 'updateRequired', message: 'midnight.errors.updateRequired' });
  });

  it('a network upgrade still says so', async () => {
    await noteMidnightNetworkUpgrading('Mainnet', 'status');
    await expect(assertMidnightWritesOpen('Mainnet')).rejects.toMatchObject({ kind: 'networkUpgrading' });
  });
});
