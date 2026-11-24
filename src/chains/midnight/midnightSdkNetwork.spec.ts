import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Network } from '@/models/types';
import { isMidnightNetworkMismatch, midnightSdkNetworkId } from './midnightSdkNetwork';

describe('the Midnight SDK network id a dApp names', () => {
  it.each([
    [Network.MAINNET, 'mainnet'],
    [Network.PREVIEW, 'preview'],
    [Network.PREPROD, 'preprod'],
    [Network.TESTNET, 'testnet'],
  ])('%s is %s', (network, id) => {
    expect(midnightSdkNetworkId(network)).toBe(id);
  });

  it('has none for the retired Stagenet or an unknown network', () => {
    for (const network of ['Stagenet', 'stagenet', 'Devnet', '']) {
      expect(() => midnightSdkNetworkId(network)).toThrow(`Unsupported Midnight network: ${network}`);
    }
  });
});

describe('connect(networkId) on a Preview wallet (issue 1453)', () => {
  it('accepts preview and no id at all', () => {
    expect(isMidnightNetworkMismatch('preview', Network.PREVIEW)).toBe(false);
    for (const none of [undefined, null, '']) expect(isMidnightNetworkMismatch(none, Network.PREVIEW)).toBe(false);
  });

  it('refuses stagenet like any other network, and any other spelling', () => {
    for (const requested of ['stagenet', 'Stagenet', 'midnight-stagenet', 'preprod', 'mainnet', 'testnet', 'Preview', 'midnight-preview', 7]) {
      expect(isMidnightNetworkMismatch(requested, Network.PREVIEW)).toBe(true);
    }
  });

  it('refuses preview on the other networks', () => {
    for (const network of [Network.MAINNET, Network.PREPROD]) expect(isMidnightNetworkMismatch('preview', network)).toBe(true);
  });

  it('is what the connect handler checks, before a known site is let in', () => {
    const bg = readFileSync(join(__dirname, '../../chrome/background.ts'), 'utf8').replace(/\r\n/g, '\n');
    const connect = bg.slice(bg.indexOf('app.add(MIDNIGHT_METHOD.connect,'));
    const check = connect.indexOf('if (isMidnightNetworkMismatch(networkId, currentWallet.network)) {');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(connect.indexOf('if (WalletStore.isWhitelisted(origin)) {'));
    expect(connect.slice(check, check + 300)).toContain('MidnightErrorCode.InvalidRequest');
  });
});
