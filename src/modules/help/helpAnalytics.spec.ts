import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ i18n: { locale: 'us' } }));
vi.mock('@/plugins/i18n', () => ({ default: h.i18n }));

type Analytics = typeof import('./helpAnalytics');
const BACKEND = 'https://backend.test';
const WIRE_KEYS = ['type', 'surface', 'locale', 'chain', 'subject'];

let fetchMock: ReturnType<typeof vi.fn>;
// Each test gets a fresh module, so its queue, dedupe set and page listeners start empty.
async function load(): Promise<Analytics> {
  vi.resetModules();
  return import('./helpAnalytics');
}
const sent = (call = 0): { events: Array<Record<string, unknown>> } => JSON.parse(fetchMock.mock.calls[call]![1].body as string);
// The real page, kept apart from the globals a test may replace.
const page = { document, window };
const setVisibility = (state: 'hidden' | 'visible'): void => {
  Object.defineProperty(page.document, 'visibilityState', { configurable: true, get: () => state });
  page.document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_BACKEND_URL', BACKEND);
  h.i18n.locale = 'us';
  fetchMock = vi.fn().mockResolvedValue({ status: 202 });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  // Drain whatever a test left queued so a stale page listener can never send into the next test.
  (await import('./helpAnalytics')).flushHelpEvents();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Object.defineProperty(page.document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('batching', () => {
  it('waits for 2 s of quiet, then sends everything queued in one request', async () => {
    const { trackHelp } = await load();
    trackHelp({ type: 'home_click', subject: 'blog', surface: 'help' });
    vi.advanceTimersByTime(1999);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent().events).toHaveLength(1);
  });

  it('restarts the quiet period with every new event', async () => {
    const { trackHelp } = await load();
    trackHelp({ type: 'home_click', subject: 'blog', surface: 'help' });
    vi.advanceTimersByTime(1500);
    trackHelp({ type: 'home_click', subject: 'topic', surface: 'help' });
    vi.advanceTimersByTime(1999);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(sent().events.map(event => event['subject'])).toEqual(['blog', 'topic']);
  });

  it('sends at once when 25 events are queued and starts a new batch after that', async () => {
    const { trackHelp } = await load();
    for (let index = 0; index < 24; index++) trackHelp({ type: 'home_click', subject: 'topic', surface: 'help' });
    expect(fetchMock).not.toHaveBeenCalled();
    trackHelp({ type: 'home_click', subject: 'topic', surface: 'help' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent().events).toHaveLength(25);
    trackHelp({ type: 'search', subject: 'empty', surface: 'help' });
    vi.advanceTimersByTime(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(1).events).toHaveLength(1);
  });

  it('flushes when the page is hidden and when it is closed, but not when it becomes visible', async () => {
    const { trackHelp } = await load();
    trackHelp({ type: 'support_chat_started', surface: 'help' });
    setVisibility('visible');
    expect(fetchMock).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    trackHelp({ type: 'welcome_open_full', surface: 'welcome' });
    page.window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Nothing is left to send, so the quiet-period timer does not send a duplicate.
    vi.advanceTimersByTime(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('posts anonymous JSON to the Help events endpoint with keepalive and no credentials', async () => {
    vi.stubEnv('VITE_BACKEND_URL', BACKEND + '/');
    const { trackHelp } = await load();
    trackHelp({ type: 'search', subject: 'results', surface: 'help' });
    vi.advanceTimersByTime(2000);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(BACKEND + '/api/help/events');
    expect(init).toEqual({
      method: 'POST', keepalive: true, credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, body: expect.any(String),
    });
  });
});

describe('what is sent', () => {
  it('carries exactly the contract fields and nothing else, whatever the caller passes', async () => {
    const { trackHelp } = await load();
    // A caller that smuggles extra data (typed away here) still cannot get it onto the wire.
    const hostile = { type: 'search', subject: 'results', surface: 'help', chain: 'midnight',
      query: 'my recovery phrase', walletId: 42, address: 'addr1qxy', stakeKey: 'stake1u9', timestamp: 1_700_000_000_000, sessionId: 'abc' };
    trackHelp(hostile as never);
    trackHelp({ type: 'article_view', subject: 'backup', surface: 'welcome' });
    trackHelp({ type: 'support_chat_started', surface: 'help' });
    vi.advanceTimersByTime(2000);
    const body = fetchMock.mock.calls[0]![1].body as string;
    expect(Object.keys(JSON.parse(body))).toEqual(['events']);
    for (const event of sent().events) expect(Object.keys(event).every(key => WIRE_KEYS.includes(key))).toBe(true);
    for (const leaked of ['recovery', 'walletId', 'addr1', 'stake1', 'timestamp', 'sessionId', '1700000000000']) expect(body).not.toContain(leaked);
    expect(sent().events).toEqual([
      { type: 'search', surface: 'help', locale: 'en-US', chain: 'midnight', subject: 'results' },
      { type: 'article_view', surface: 'welcome', locale: 'en-US', chain: 'all', subject: 'backup' },
      { type: 'support_chat_started', surface: 'help', locale: 'en-US', chain: 'all' },
    ]);
  });

  it('accepts every contract row and leaves the subject off the ones that have none', async () => {
    const { trackHelp } = await load();
    const rows = [
      { type: 'article_view', subject: 'backup' }, { type: 'article_helpful_yes', subject: 'midnight-dust' }, { type: 'article_helpful_no', subject: 'bitcoin-fix' },
      { type: 'search', subject: 'empty' }, { type: 'home_click', subject: 'x_nexus' }, { type: 'home_click', subject: 'all_tutorials' },
      { type: 'updates_filter', subject: 'ecosystem-news' }, { type: 'updates_filter', subject: 'all' }, { type: 'update_open', subject: 'bitcoin-news' },
      { type: 'support_open', subject: 'noWallets' }, { type: 'support_chat_started' }, { type: 'support_email', subject: 'reader' },
      { type: 'support_email_copied', subject: 'welcome' }, { type: 'welcome_open', subject: 'setup' }, { type: 'welcome_open_full' },
    ];
    for (const row of rows) trackHelp({ ...row, surface: 'help' } as never);
    vi.advanceTimersByTime(2000);
    const events = sent().events;
    expect(events).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) {
      expect(events[index]!['type']).toBe(row.type);
      expect('subject' in events[index]! ? events[index]!['subject'] : undefined).toBe(row.subject);
    }
  });

  it('fills the locale from the app language and defaults the chain to all', async () => {
    const { trackHelp } = await load();
    for (const [app, wire] of [['us', 'en-US'], ['de', 'de-DE'], ['es', 'es-ES']] as const) {
      h.i18n.locale = app;
      trackHelp({ type: 'home_click', subject: 'blog', surface: 'help' });
      vi.advanceTimersByTime(2000);
      expect(sent(fetchMock.mock.calls.length - 1).events[0]).toMatchObject({ locale: wire, chain: 'all' });
    }
  });

  it('drops an event whose subject is outside the allow-list and keeps the rest', async () => {
    const { trackHelp } = await load();
    const bad = [
      { type: 'home_click', subject: 'carousel' }, { type: 'search', subject: 'how do I restore my wallet' }, { type: 'support_open', subject: 'weird' },
      { type: 'article_view', subject: 'two words' }, { type: 'article_view', subject: 'x'.repeat(81) }, { type: 'article_view', subject: '' },
      { type: 'article_view' }, { type: 'update_open', subject: 'all' }, { type: 'support_email_copied', subject: 'reader' },
      { type: 'made_up', subject: 'blog' }, { type: 'constructor', subject: 'blog' }, { type: 'home_click', subject: 'blog', surface: 'popup' },
    ];
    for (const event of bad) trackHelp({ surface: 'help', ...event } as never);
    trackHelp({ type: 'home_click', subject: 'blog', surface: 'help' });
    vi.advanceTimersByTime(2000);
    expect(sent().events).toEqual([{ type: 'home_click', surface: 'help', locale: 'en-US', chain: 'all', subject: 'blog' }]);
  });

  it('counts an article view once per surface and article for the life of the page', async () => {
    const { trackHelp } = await load();
    trackHelp({ type: 'article_view', subject: 'backup', surface: 'help' });
    trackHelp({ type: 'article_view', subject: 'backup', surface: 'help', chain: 'cardano' });
    trackHelp({ type: 'article_view', subject: 'backup', surface: 'welcome' });
    trackHelp({ type: 'article_view', subject: 'restore', surface: 'help' });
    // Only article views are deduplicated.
    trackHelp({ type: 'article_helpful_yes', subject: 'backup', surface: 'help' });
    trackHelp({ type: 'article_helpful_yes', subject: 'backup', surface: 'help' });
    vi.advanceTimersByTime(2000);
    expect(sent().events.map(event => `${event['type']}:${event['surface']}:${event['subject']}`)).toEqual([
      'article_view:help:backup', 'article_view:welcome:backup', 'article_view:help:restore',
      'article_helpful_yes:help:backup', 'article_helpful_yes:help:backup',
    ]);
    vi.advanceTimersByTime(60_000);
    trackHelp({ type: 'article_view', subject: 'backup', surface: 'help' });
    vi.advanceTimersByTime(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('when nothing is sent', () => {
  async function silent(setup: () => void): Promise<void> {
    setup();
    const { trackHelp } = await load();
    trackHelp({ type: 'article_view', subject: 'backup', surface: 'help' });
    trackHelp({ type: 'support_chat_started', surface: 'help' });
    vi.advanceTimersByTime(10_000);
    setVisibility('hidden');
    page.window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).not.toHaveBeenCalled();
  }

  it('respects Do Not Track', () => silent(() => vi.stubGlobal('navigator', { doNotTrack: '1' })));
  it('respects Global Privacy Control', () => silent(() => vi.stubGlobal('navigator', { globalPrivacyControl: true })));
  it('needs a backend URL', () => silent(() => vi.stubEnv('VITE_BACKEND_URL', '')));
  it.each(['not a url', 'ftp://backend.test', 'javascript:alert(1)', '/relative'])('rejects the invalid backend URL %s', value => silent(() => vi.stubEnv('VITE_BACKEND_URL', value)));
  it('does nothing outside a browser page', () => silent(() => { vi.stubGlobal('window', undefined); vi.stubGlobal('document', undefined); }));
  it('does nothing without fetch', () => silent(() => vi.stubGlobal('fetch', undefined)));

  it('still sends when the browser says tracking is allowed', async () => {
    vi.stubGlobal('navigator', { doNotTrack: '0', globalPrivacyControl: false });
    const { trackHelp } = await load();
    trackHelp({ type: 'support_chat_started', surface: 'help' });
    vi.advanceTimersByTime(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops what was queued if the person opts out before it is sent', async () => {
    const { trackHelp } = await load();
    trackHelp({ type: 'support_chat_started', surface: 'help' });
    vi.stubGlobal('navigator', { doNotTrack: '1' });
    vi.advanceTimersByTime(2000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('failure handling', () => {
  it('swallows a rejected request, a synchronous throw and a missing response, without retrying or logging', async () => {
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method).mockImplementation(() => {}));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { trackHelp } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockImplementationOnce(() => { throw new Error('blocked'); });
    fetchMock.mockReturnValueOnce(undefined);
    for (const subject of ['blog', 'topic', 'most_viewed'] as const) {
      expect(() => trackHelp({ type: 'home_click', subject, surface: 'help' })).not.toThrow();
      vi.advanceTimersByTime(2000);
    }
    await vi.advanceTimersByTimeAsync(10_000);
    // No retry: three batches, three requests, however they ended.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(unhandled).not.toHaveBeenCalled();
    for (const spy of consoles) expect(spy).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
    consoles.forEach(spy => spy.mockRestore());
  });

  it('never throws into the caller for malformed input', async () => {
    const { trackHelp } = await load();
    for (const event of [undefined, null, {}, { type: 5 }, { type: 'search', surface: {} }, 'search'] as unknown[]) {
      expect(() => trackHelp(event as never)).not.toThrow();
    }
    vi.advanceTimersByTime(2000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps nothing between pages: a fresh page starts with an empty queue and no remembered views', async () => {
    const first = await load();
    first.trackHelp({ type: 'article_view', subject: 'backup', surface: 'help' });
    first.flushHelpEvents();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const second = await load();
    second.trackHelp({ type: 'article_view', subject: 'backup', surface: 'help' });
    second.flushHelpEvents();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
