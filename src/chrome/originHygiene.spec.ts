import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchesDappWhitelistEntry } from '@/stores/walletStore';
import { authorizationStillHolds, sessionApprovedAccounts, sessionAuthorizesWallet, walletCaip10Account } from '@/services/walletConnect/sessionBinding';
import { claimedOriginMatchesSender, embeddingSite } from './originBinding';

describe('matchesDappWhitelistEntry', () => {
  it('matches a full-origin entry exactly (scheme, host and port)', () => {
    expect(matchesDappWhitelistEntry('https://dapp.example', 'https://dapp.example')).toBe(true);
    expect(matchesDappWhitelistEntry('http://dapp.example', 'https://dapp.example')).toBe(false);
    expect(matchesDappWhitelistEntry('https://dapp.example:8443', 'https://dapp.example')).toBe(false);
    expect(matchesDappWhitelistEntry('https://dapp.example.evil.example', 'https://dapp.example')).toBe(false);
  });

  it('a legacy bare-hostname entry now covers https on the default port only', () => {
    expect(matchesDappWhitelistEntry('https://dapp.example', 'dapp.example')).toBe(true);
    expect(matchesDappWhitelistEntry('http://dapp.example', 'dapp.example')).toBe(false);
    expect(matchesDappWhitelistEntry('https://dapp.example:8443', 'dapp.example')).toBe(false);
    expect(matchesDappWhitelistEntry('https://dapp.example:8443', 'dapp.example:8443')).toBe(true);
  });

  it('keeps local development working (http, any port) for legacy localhost entries', () => {
    expect(matchesDappWhitelistEntry('http://localhost:3000', 'localhost')).toBe(true);
    expect(matchesDappWhitelistEntry('http://127.0.0.1:5173', '127.0.0.1')).toBe(true);
    expect(matchesDappWhitelistEntry('http://localhost.evil.example', 'localhost')).toBe(false);
  });

  it('never matches an opaque origin', () => {
    expect(matchesDappWhitelistEntry('null', 'null')).toBe(false);
  });
});

describe('WalletConnect session binding', () => {
  const ADDR = 'addr1qxck3xjmnvlpn3lyfvrxhx0k7d2mcsz5fzhpn8v7ss4vwhk2akaxldknpvrqfrepnthdlspf98jefvcmyyhjaqx9vjqsknpe6h';
  const MAINNET = 'cip34:1-764824073';
  const session = { namespaces: { cip34: { accounts: [`${MAINNET}:${ADDR}`] } } };
  const mainnetWallet = { id: 1, chain: 'Cardano', network: 'Mainnet', baseAddress: ADDR };

  it('keeps the full CAIP-10 accounts, chain and network included', () => {
    expect([...sessionApprovedAccounts(session)]).toEqual([`${MAINNET}:${ADDR}`]);
    expect(walletCaip10Account(mainnetWallet)).toBe(`${MAINNET}:${ADDR}`);
    expect(walletCaip10Account({ chain: 'Bitcoin', network: 'Mainnet', baseAddress: 'x', bitcoinAddress: 'bc1q' }))
      .toBe('bip122:000000000019d6689c085ae165831e93:bc1q');
    expect(walletCaip10Account({ chain: 'Apex Prime', network: 'Mainnet', baseAddress: ADDR })).toBeNull();
  });

  it('authorises only the wallet that approved the session', () => {
    expect(sessionAuthorizesWallet(session, mainnetWallet)).toBe(true);
    expect(sessionAuthorizesWallet(session, { ...mainnetWallet, baseAddress: 'addr1other' })).toBe(false);
    expect(sessionAuthorizesWallet(null, mainnetWallet)).toBe(false);
    expect(sessionAuthorizesWallet(session, null)).toBe(false);
  });

  it('never authorises the same address on a network the session did not approve (PR #1241 review)', () => {
    // One seed restored on Preprod and Preview: same addr_test… address, different chains.
    const TEST_ADDR = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
    const preprodSession = { namespaces: { cip34: { accounts: [`cip34:0-1:${TEST_ADDR}`] } } };
    const preprod = { id: 5, chain: 'Cardano', network: 'Preprod', baseAddress: TEST_ADDR };
    const preview = { id: 6, chain: 'Cardano', network: 'Preview', baseAddress: TEST_ADDR };
    expect(sessionAuthorizesWallet(preprodSession, preprod, 'cip34:0-1')).toBe(true);
    expect(sessionAuthorizesWallet(preprodSession, preview)).toBe(false);
    expect(sessionAuthorizesWallet(preprodSession, preview, 'cip34:0-1')).toBe(false);
    // A request for another chain is not answered with this wallet, even on an approved account.
    expect(sessionAuthorizesWallet(preprodSession, preprod, 'cip34:0-2')).toBe(false);
  });

  it('releases a signature only if the authorization still holds after approval', () => {
    const wallet = mainnetWallet;
    expect(authorizationStillHolds(session, wallet, { ...wallet }, false, MAINNET)).toBe(true);
    // Locked while the prompt was open.
    expect(authorizationStillHolds(session, wallet, wallet, true, MAINNET)).toBe(false);
    // Peer disconnected the session meanwhile.
    expect(authorizationStillHolds(null, wallet, wallet, false, MAINNET)).toBe(false);
    // Switched to another wallet, or logged out.
    expect(authorizationStillHolds(session, wallet, { ...wallet, id: 2, baseAddress: 'addr1other' }, false, MAINNET)).toBe(false);
    expect(authorizationStillHolds(session, wallet, { ...wallet, id: 2 }, false, MAINNET)).toBe(false);
    expect(authorizationStillHolds(session, wallet, null, false, MAINNET)).toBe(false);
    // Same wallet id and address but the network changed under the prompt.
    expect(authorizationStillHolds(session, wallet, { ...wallet, network: 'Preview' }, false, MAINNET)).toBe(false);
    // The request was for another chain.
    expect(authorizationStillHolds(session, wallet, wallet, false, 'cip34:0-1')).toBe(false);
  });

  it('the WalletConnect signing relay never answers success without that re-check', () => {
    // Normalize CRLF (Windows checkouts) before slicing on newline delimiters.
    const bg = readFileSync(join(__dirname, 'background.ts'), 'utf8').replace(/\r\n/g, '\n');
    const start = bg.indexOf('async function routeWcSigningRequest(');
    const fn = bg.slice(start, bg.indexOf('\n  }\n', start));
    const releaseAt = fn.indexOf('const release = async');
    expect(releaseAt).toBeGreaterThan(-1);
    expect(fn.slice(releaseAt)).toContain('authorizationStillHolds(wcService.getSessionForTopic(topic), walletAtRequest, WalletStore.state.loggedWallet, walletStore.isLocked, chainId)');
    // Exactly one success path, inside release().
    expect(fn.match(/respondSuccess\(/g)).toHaveLength(1);
    // The request entry check binds the chain too, and every signing route passes it on.
    expect(bg).toContain('sessionAuthorizesWallet(wcService.getSessionForTopic(topic), loggedWallet, chainId)');
    expect(bg.match(/topic, id, POPUP\.\w+, \[\d+, \d+\], chainId,/g)).toHaveLength(4);
  });
});

describe('origin binding to the real MessageSender', () => {
  const frame = (origin: string, extra: Partial<chrome.runtime.MessageSender> = {}) =>
    ({ id: 'ext', origin, url: `${origin}/page`, frameId: 0, ...extra }) as chrome.runtime.MessageSender;

  it('accepts a claimed origin equal to the browser-reported one', () => {
    expect(claimedOriginMatchesSender('https://dapp.example', frame('https://dapp.example'))).toBe(true);
  });

  it('refuses a claimed origin that differs from the sending frame', () => {
    expect(claimedOriginMatchesSender('https://trusted.example', frame('https://evil.example'))).toBe(false);
  });

  it('falls back to the frame URL when sender.origin is absent', () => {
    expect(claimedOriginMatchesSender('https://evil.example', { id: 'ext', url: 'https://dapp.example/x' } as chrome.runtime.MessageSender)).toBe(false);
  });

  it('lets origin-less messages through (handlers refuse them on the whitelist)', () => {
    expect(claimedOriginMatchesSender(undefined, frame('https://dapp.example'))).toBe(true);
  });

  it('names the embedding site only for a cross-origin embedded frame', () => {
    const tab = { url: 'https://host.example/page' } as chrome.tabs.Tab;
    expect(embeddingSite('https://dapp.example', frame('https://dapp.example', { frameId: 3, tab }))).toBe('https://host.example');
    expect(embeddingSite('https://host.example', frame('https://host.example', { frameId: 3, tab }))).toBeUndefined();
    expect(embeddingSite('https://dapp.example', frame('https://dapp.example', { frameId: 0, tab }))).toBeUndefined();
  });
});

describe('router refuses a dApp message whose origin was forged in the body', () => {
  let listener: (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r?: unknown) => void) => boolean;
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: { id: 'ext', onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, onConnect: { addListener: () => {} } },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('drops the forged message before any handler runs', async () => {
    const { Messaging } = await import('./messaging');
    const { SENDER, TARGET } = await import('./config');
    const app = Messaging.createBackgroundController();
    const handled: string[] = [];
    app.add('signTx', (_r, send) => { handled.push('signTx'); send({ data: 'ok' }); });
    app.listen();
    const out: unknown[] = [];
    const sender = { id: 'ext', origin: 'https://evil.example', url: 'https://evil.example/', frameId: 0 } as chrome.runtime.MessageSender;
    listener({ method: 'signTx', sender: SENDER.webpage, target: TARGET, origin: 'https://trusted.example', data: {} }, sender, r => out.push(r));
    expect(handled).toEqual([]);
    expect((out[0] as { error?: unknown }).error).toBeTruthy();

    listener({ method: 'signTx', sender: SENDER.webpage, target: TARGET, origin: 'https://evil.example', data: {} }, sender, r => out.push(r));
    expect(handled).toEqual(['signTx']);
  });
});

describe('origin hygiene wiring tripwires', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('popup connects store the full origin, never the header hostname', () => {
    const src = read('popup/modules/views/DappConnect.vue');
    expect(src).not.toContain('addConnectedDapp(loggedWallet.value.id, vmProxy.$refs.popupHeader.domain)');
    expect(src).toContain('new URL(String(vmProxy.$route.query?.website');
  });

  it('the side-panel header matches connected sites exactly, not by substring', () => {
    expect(read('sidepanel/components/MiniHeader.vue')).not.toMatch(/origin\.indexOf\(String\(d\.domain\)\)/);
  });

  it('the connected-dApps list never sends domains to a third-party favicon service', () => {
    expect(read('modules/dashboard/components/ConnectedDappsTab.vue')).not.toContain('gstatic.com');
  });

  it('every WalletConnect request checks the session belongs to the active wallet', () => {
    expect(read('chrome/background.ts')).toContain('sessionAuthorizesWallet(wcService.getSessionForTopic(topic), loggedWallet, chainId)');
  });
});

describe('embedding-site warning on popup approvals (PR #2 review)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

  it('the background hands the popup the browser-derived embedding site, overriding anything in the request', () => {
    const bg = read('chrome/background.ts');
    expect(bg).toContain('Messaging.sendToPopupInternal(newTab.id, { ...request, embeddedIn: enablePayload.embeddedIn })');
    expect(bg).toContain('{ ...JSON.parse(JSON.stringify(request)), embeddedIn: signTxPayload.embeddedIn }');
    expect(bg).toContain('Messaging.sendToPopupInternal(tab.id, { ...request, embeddedIn: signDataPayload.embeddedIn })');
  });

  it('the Bitcoin connect and sign paths carry it to the side panel and the popup too', () => {
    const bg = read('chrome/background.ts');
    const handler = (name: string) => {
      const start = bg.indexOf(`app.add(BITCOIN_METHOD.${name}, `);
      expect(start, name).toBeGreaterThan(-1);
      return bg.slice(start, bg.indexOf('\napp.add(', start + 10));
    };
    const enable = handler('enable');
    expect(enable).toContain('const embeddedIn = embeddingSite(origin, send);');
    expect(enable).toContain("sendToMiniGero('enable', { ...request.data, website: origin, embeddedIn }, tabId)");
    expect(enable).toContain('Messaging.sendToPopupInternal(tab.id, { ...request, embeddedIn })');
    for (const [name, payload] of [['signPsbt', 'btcSignPsbtPayload'], ['signMessage', 'btcSignMessagePayload']]) {
      const h = handler(name);
      expect(h).toContain('embeddedIn: embeddingSite(request.origin, request.send)');
      expect(h).toContain(`Messaging.sendToPopupInternal(tab.id, { ...request, embeddedIn: ${payload}.embeddedIn })`);
    }
    const batch = handler('signPsbts');
    expect(batch).toContain('const embeddedIn = embeddingSite(request.origin, request.send);');
    expect(batch).toContain('data: { psbtHex, options }, embeddedIn }');
    expect(batch).toContain('website: request.origin, favIconUrl, embeddedIn }');
  });

  it('connect, signTx and signData popups render the warning', () => {
    for (const view of ['DappConnect', 'SignTx', 'DappSignData', 'BitcoinSignPsbt', 'BitcoinSignMessage']) {
      expect(read(`popup/modules/views/${view}.vue`)).toMatch(/<EmbeddedSiteWarning [^>]*:embedded-in="/);
    }
  });
});
