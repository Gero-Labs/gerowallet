import { afterEach, describe, expect, it, vi } from 'vitest';
import { critical, headline, product, warning } from '@/services/announcements/__fixtures__/stored';
import { ANNOUNCEMENT_ROUTES, iconOf, openGeroUrl, resolveAction, toneOf } from './announcementView';

const doc = (actionRoute: string | null, actionUrl: string | null = null) => ({ actionRoute, actionUrl });

describe('the one action of an announcement', () => {
  it('follows a route key only through the fixed map', () => {
    expect(resolveAction(doc('/staking'), 'dashboard')).toEqual({ type: 'route', path: '/staking', labelKey: 'announce.action.staking', handOver: false });
    expect(resolveAction(doc('/collectibles'), 'dashboard')).toEqual({ type: 'route', path: '/?view=collectibles', labelKey: 'announce.action.collectibles', handOver: false });
    // The side panel has its own page for some, and hands over to the dashboard for the rest.
    expect(resolveAction(doc('/transactions'), 'sidepanel')).toEqual({ type: 'route', path: '/activity', labelKey: 'announce.action.transactions', handOver: false });
    expect(resolveAction(doc('/swap'), 'sidepanel')).toEqual({ type: 'route', path: '/swap', labelKey: 'announce.action.swapInDashboard', handOver: true });
  });

  it('offers nothing for a key that is not in the map, however it is spelled', () => {
    for (const key of ['/send', '/sign-tx', '/dapp-connect', '/dapp-sign', '/wc-session-proposal', '/staking/', '/Staking', 'staking', '/staking?x=1', '/../swap', '', '/constructor', '/__proto__']) {
      expect(resolveAction(doc(key), 'dashboard')).toBeNull();
      expect(resolveAction(doc(key), 'sidepanel')).toBeNull();
    }
  });

  it('never leads to a flow that moves funds or grants access', () => {
    const paths = [...ANNOUNCEMENT_ROUTES.values()].flatMap((t) => [t.dashboard, t.sidepanel ?? '']);
    expect([...ANNOUNCEMENT_ROUTES.keys()].sort()).toEqual(['/', '/collectibles', '/governance', '/staking', '/swap', '/transactions']);
    for (const path of paths) expect(path).not.toMatch(/send|sign|connect|dapp|wc-|passkey|ledger|warning|dev-tools/i);
  });

  it('prefers the route key, and takes a link only to one of the sites of Gero', () => {
    expect(resolveAction(doc(null, 'https://support.gerowallet.io/help/sync'), 'dashboard')).toEqual({ type: 'url', url: 'https://support.gerowallet.io/help/sync', host: 'support.gerowallet.io' });
    for (const url of ['https://gerowallet.io.evil.test/', 'https://gerowallet.io@evil.test/', 'http://gerowallet.io/', 'javascript:alert(1)', 'chrome-extension://abc/index.html#/send']) {
      expect(resolveAction(doc(null, url), 'dashboard')).toBeNull();
    }
    expect(resolveAction(doc(null, null), 'dashboard')).toBeNull();
    // An unknown key is no action, even when a link sits beside it.
    expect(resolveAction(doc('/send', 'https://gerowallet.io/'), 'dashboard')).toBeNull();
  });
});

describe('openGeroUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens one of the sites of Gero in a new tab that cannot reach back', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openGeroUrl('https://gerowallet.io/blog/post')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://gerowallet.io/blog/post', '_blank', 'noopener,noreferrer');
  });

  it('refuses everything else', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    for (const url of [null, '', 'https://evil.test/', 'https://gerowallet.io.evil.test/', 'javascript:alert(1)']) expect(openGeroUrl(url)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('tone and icon', () => {
  it('come from the severity and the kind', () => {
    expect(toneOf(critical(1))).toBe('error');
    expect(toneOf(warning(2))).toBe('warning');
    expect(toneOf(product(3))).toBe('neutral');
    expect(iconOf(critical(1))).toBe('mdi-alert-outline');
    expect(iconOf(product(3))).toBe('mdi-creation-outline');
    expect(iconOf(headline(4))).toBe('mdi-newspaper-variant-outline');
  });
});
