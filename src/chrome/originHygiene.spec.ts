import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchesDappWhitelistEntry } from '@/stores/walletStore';
import { sessionApprovedAddresses, sessionAuthorizesWallet } from '@/services/walletConnect/sessionBinding';
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
  const session = { namespaces: { cip34: { accounts: [`cip34:1-764824073:${ADDR}`] } } };

  it('reads the approved addresses from CAIP-10 accounts', () => {
    expect([...sessionApprovedAddresses(session)]).toEqual([ADDR]);
  });

  it('authorises only the wallet that approved the session', () => {
    expect(sessionAuthorizesWallet(session, { baseAddress: ADDR })).toBe(true);
    expect(sessionAuthorizesWallet(session, { baseAddress: 'addr1other' })).toBe(false);
    expect(sessionAuthorizesWallet(null, { baseAddress: ADDR })).toBe(false);
    expect(sessionAuthorizesWallet(session, null)).toBe(false);
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
    expect(read('chrome/background.ts')).toContain('sessionAuthorizesWallet(wcService.getSessionForTopic(topic), loggedWallet)');
  });
});
