import { afterEach, describe, expect, it, vi } from 'vitest';
import { GERO_CLIENT_HEADER, extensionVersion, geroClientHeaders, geroClientValue, isVersionBelow } from './midnightClientVersion';

afterEach(() => vi.unstubAllGlobals());

describe('X-Gero-Client', () => {
  it('names the extension and its manifest version', () => {
    vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '2.8.4' }) } });
    expect(extensionVersion()).toBe('2.8.4');
    expect(geroClientValue()).toBe('extension/2.8.4');
    expect(geroClientHeaders()).toEqual({ [GERO_CLIENT_HEADER]: 'extension/2.8.4' });
    expect(GERO_CLIENT_HEADER).toBe('X-Gero-Client');
  });

  it('sends nothing made up when the version is unknown', () => {
    expect(extensionVersion()).toBe('');
    expect(geroClientHeaders()).toEqual({});
    vi.stubGlobal('chrome', { runtime: { getManifest: () => { throw new Error('no manifest'); } } });
    expect(geroClientHeaders()).toEqual({});
  });
});

describe('isVersionBelow', () => {
  it.each([
    ['2.8.4', '2.9.0', true],
    ['2.8.4', '2.8.10', true],
    ['2.8', '2.8.1', true],
    ['2.9.0', '2.9.0', false],
    ['2.9.0', '2.9', false],
    ['2.10.0', '2.9.9', false],
    ['3.0.0', '2.99.0', false],
    ['v2.8.4', '2.8.5', true],
  ])('%s below %s: %s', (version, minimum, below) => {
    expect(isVersionBelow(version, minimum)).toBe(below);
  });

  it('never locks a build out on something that is not a version', () => {
    expect(isVersionBelow('2.8.4', 'latest')).toBe(false);
    expect(isVersionBelow('', '2.9.0')).toBe(false);
    expect(isVersionBelow('dev', '2.9.0')).toBe(false);
  });
});
