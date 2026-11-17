import { describe, expect, it } from 'vitest';
import { derivedEnv } from './env-defaults.mjs';

describe('derivedEnv', () => {
  it('derives Nexus from the backend and the flag service from Gero Sync', () => {
    expect(derivedEnv({ VITE_BACKEND_URL: 'https://api.gerowallet.io/', VITE_SYNC_WS_URL: 'wss://sync.gerowallet.io' })).toEqual({
      VITE_NEXUS_URL: 'https://api.gerowallet.io/api/nexus',
      VITE_FLAGS_BASE_URL: 'https://sync.gerowallet.io',
    });
  });

  it('maps ws to http for a local Gero Sync', () => {
    expect(derivedEnv({ VITE_SYNC_WS_URL: 'ws://localhost:8090' })).toEqual({ VITE_FLAGS_BASE_URL: 'http://localhost:8090' });
  });

  it('never overrides a value set explicitly', () => {
    expect(derivedEnv({
      VITE_BACKEND_URL: 'https://a', VITE_NEXUS_URL: 'https://nexus',
      VITE_SYNC_WS_URL: 'wss://s', VITE_FLAGS_BASE_URL: 'https://flags',
    })).toEqual({});
  });

  it('derives nothing from nothing', () => {
    expect(derivedEnv({})).toEqual({});
    expect(derivedEnv({ VITE_SYNC_WS_URL: 'https://not-a-socket' })).toEqual({});
  });
});
