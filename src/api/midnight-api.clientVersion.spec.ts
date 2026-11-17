// Issue 1468: the build's version on every Midnight request, and what the server
// says about the builds it accepts (the 501's reason, the status read's minimum
// version and ledger).
import { afterEach, describe, expect, it, vi } from 'vitest';

const { created } = vi.hoisted(() => ({ created: [] as Array<{ headers?: Record<string, string> }> }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const instance = { get: vi.fn(), interceptors: { request: { use: () => undefined }, response: { use: () => undefined } } };
  return {
    ...actual,
    default: { ...actual.default, create: (config: { headers?: Record<string, string> }) => { created.push(config); return instance; } },
  };
});
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: vi.fn(), reauthenticateNexus: vi.fn() }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

const { MidnightApi, midnightWriteOutcome, parseMidnightWriteStatus } = await import('./midnight-api');
const { midnightApiErrorFromResponse, midnightSendBlockOf } = await import('./midnightApiError');

afterEach(() => vi.unstubAllGlobals());

const BASE = 'https://nexus.example/api/midnight/midnight-mainnet';

describe('X-Gero-Client on Midnight requests', () => {
  it('every MidnightApi request carries extension/<manifest version>', () => {
    vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '2.8.4' }) } });
    created.length = 0;
    new MidnightApi('Mainnet');
    expect(created[0]?.headers).toMatchObject({ 'X-Gero-Client': 'extension/2.8.4', 'Content-Type': 'application/json' });
  });

  it('the direct Nexus Midnight requests carry it too', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const file of ['midnightDustLightTransport.ts', 'midnightChainIdentity.ts']) {
      const source = readFileSync(join(__dirname, '../chains/midnight', file), 'utf8');
      expect(source).toMatch(/Authorization: `Bearer \$\{token\}`, \.\.\.geroClientHeaders\(\) \}/);
    }
  });
});

describe('a 501 whose reason says this build must update', () => {
  const upgrading = (reason?: string) => ({ errorCode: 'MIDNIGHT_NETWORK_UPGRADING', message: 'm', ...(reason ? { reason } : {}) });

  it('moves the gate to "update required", not the network upgrade', () => {
    expect(midnightWriteOutcome('Mainnet', { url: `${BASE}/tx/submit`, status: 501, data: upgrading('CLIENT_UPDATE_REQUIRED') })).toBe('updateRequired');
    expect(midnightWriteOutcome('Mainnet', { url: `${BASE}/tx/submit`, status: 501, data: upgrading('NETWORK_UPGRADING') })).toBe('paused');
    expect(midnightWriteOutcome('Mainnet', { url: `${BASE}/tx/submit`, status: 501, data: upgrading() })).toBe('paused');
  });

  it('reads as the update sentence and blocks the send screen', () => {
    const error = midnightApiErrorFromResponse(501, upgrading('CLIENT_UPDATE_REQUIRED'), {}, 'Mainnet', 'submit');
    expect(error.kind).toBe('updateRequired');
    expect(error.message).toBe('midnight.errors.updateRequired');
    expect(midnightSendBlockOf(error)).toBe('updateRequired');
    expect(midnightSendBlockOf(midnightApiErrorFromResponse(501, upgrading('NETWORK_UPGRADING'), {}, 'Mainnet'))).toBe('networkUpgrading');
  });
});

describe('the status read: minimum version and ledger', () => {
  it('reads minClientVersion.extension and the ledger when present', () => {
    expect(parseMidnightWriteStatus({
      writesOpen: true, ledger: 9, protocolVersion: 9000, minClientVersion: { extension: '2.9.0', ios: '1.4.0', android: '1.2.0' },
    })).toEqual({ kind: 'open', minExtensionVersion: '2.9.0', ledger: 9 });
    expect(parseMidnightWriteStatus({ writesOpen: false, reason: 'NETWORK_UPGRADING', message: 'm', ledger: 'ledger-9' }))
      .toEqual({ kind: 'closed', reason: 'NETWORK_UPGRADING', message: 'm', ledger: 9 });
    expect(parseMidnightWriteStatus({ writesOpen: true, ledger: '9.0.1' })).toEqual({ kind: 'open', ledger: 9 });
    expect(parseMidnightWriteStatus({ writesOpen: false, reason: 'CLIENT_UPDATE_REQUIRED' }))
      .toEqual({ kind: 'closed', reason: 'CLIENT_UPDATE_REQUIRED', message: undefined });
  });

  it('falls back cleanly when they are missing or not readable', () => {
    expect(parseMidnightWriteStatus({ writesOpen: true })).toEqual({ kind: 'open' });
    expect(parseMidnightWriteStatus({ writesOpen: true, minClientVersion: null, ledger: null })).toEqual({ kind: 'open' });
    expect(parseMidnightWriteStatus({ writesOpen: true, minClientVersion: { extension: 'soon', ios: '1.0' }, ledger: 'next' }))
      .toEqual({ kind: 'open' });
    expect(parseMidnightWriteStatus({ writesOpen: true, minClientVersion: { ios: '1.0' }, ledger: 0 })).toEqual({ kind: 'open' });
  });
});
