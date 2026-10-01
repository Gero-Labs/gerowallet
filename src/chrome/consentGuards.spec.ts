import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isConnectApproval } from './connectApproval';
import { decideSignTxPopup, popupWebsite } from './signTxPopupPolicy';
import { approvalStillValid } from './approvalRelease';

describe('isConnectApproval', () => {
  it('accepts only an explicit true', () => {
    expect(isConnectApproval({ data: true })).toBe(true);
  });

  it('rejects truthy look-alikes and declines (the old popup Decline sent { data: {} })', () => {
    for (const data of [{}, [], 'yes', 1, false, null, undefined]) {
      expect(isConnectApproval({ data })).toBe(false);
    }
    expect(isConnectApproval(undefined)).toBe(false);
    expect(isConnectApproval(null)).toBe(false);
  });
});

describe('signTx popup policy', () => {
  const ROUTE = 'sign-tx';
  const url = (origin: string) => `chrome-extension://abc/index.html#/${ROUTE}?website=${encodeURIComponent(origin)}`;

  it('reads the website of a signTx popup and ignores other routes', () => {
    expect(popupWebsite(url('https://a.example'), ROUTE)).toBe('https://a.example');
    expect(popupWebsite('chrome-extension://abc/index.html#/dapp-connect?website=x', ROUTE)).toBeNull();
    expect(popupWebsite('chrome-extension://abc/index.html', ROUTE)).toBeNull();
    expect(popupWebsite(undefined, ROUTE)).toBeNull();
  });

  it('opens when no signTx prompt is pending', () => {
    expect(decideSignTxPopup([undefined, 'chrome-extension://abc/index.html#/dapp-connect?website=x'], 'https://a.example', ROUTE))
      .toEqual({ action: 'open', closeTabUrls: [] });
  });

  it('lets an origin supersede its own pending prompt', () => {
    expect(decideSignTxPopup([url('https://a.example')], 'https://a.example', ROUTE))
      .toEqual({ action: 'open', closeTabUrls: [url('https://a.example')] });
  });

  it('never lets another origin close and replace a pending prompt', () => {
    expect(decideSignTxPopup([url('https://victim.example')], 'https://attacker.example', ROUTE)).toEqual({ action: 'busy' });
    expect(decideSignTxPopup([url('https://a.example'), url('https://b.example')], 'https://a.example', ROUTE)).toEqual({ action: 'busy' });
  });
});

describe('approvalStillValid', () => {
  const connected = new Set(['https://a.example']);
  const isWhitelisted = (o: string) => connected.has(o);

  it('releases while the origin is connected and the wallet is unchanged', () => {
    expect(approvalStillValid({ origin: 'https://a.example', walletIdAtRequest: 1 }, isWhitelisted, 1)).toBe(true);
  });

  it('withholds after the site was revoked during the prompt', () => {
    expect(approvalStillValid({ origin: 'https://b.example', walletIdAtRequest: 1 }, isWhitelisted, 1)).toBe(false);
  });

  it('withholds after a wallet switch during the prompt', () => {
    expect(approvalStillValid({ origin: 'https://a.example', walletIdAtRequest: 1 }, isWhitelisted, 2)).toBe(false);
  });

  it('fails closed without an origin', () => {
    expect(approvalStillValid({ origin: undefined, walletIdAtRequest: 1 }, isWhitelisted, 1)).toBe(false);
  });
});

/**
 * Source tripwires: the four consent bugs must not come back through a refactor
 * of the code paths that the unit tests above can't load (background.ts and SFCs).
 */
describe('consent wiring tripwires', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  const handler = (src: string, name: string) => {
    const start = src.indexOf(`app.add(${name},`);
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf('\napp.add', start + 10);
    return src.slice(start, next < 0 ? undefined : next);
  };
  const bg = read('chrome/background.ts');

  it('signData and signTx build the prompt from explicit fields, never a spread of page data', () => {
    for (const name of ['METHOD.signData', 'METHOD.signTx']) {
      const body = handler(bg, name);
      expect(body).not.toMatch(/\{\s*\.\.\.request\.data/);
      expect(body).toContain('guardedSignReply(request, sendResponse)');
    }
  });

  it('every enable handler connects only on isConnectApproval', () => {
    for (const name of ['METHOD.enable', 'BITCOIN_METHOD.enable']) {
      const body = handler(bg, name);
      expect(body).toContain('isConnectApproval(');
      expect(body).not.toMatch(/if \(response\.data\)/);
    }
  });

  it('the signTx popup path asks the popup policy instead of force-closing other prompts', () => {
    const body = handler(bg, 'METHOD.signTx');
    expect(body).toContain('decideSignTxPopup(');
  });

  it('the side-panel signData preview shows only the signed payload', () => {
    const overlay = read('sidepanel/components/DAppOverlay.vue');
    expect(overlay).not.toMatch(/payload\?\.message/);
  });

  it('the popup Decline answers data:false', () => {
    const connect = read('popup/modules/views/DappConnect.vue');
    expect(connect).toContain("returnData({ data: false, error: APIError.Refused })");
    expect(connect).not.toContain('returnData({ data: {}');
  });
});
