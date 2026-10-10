import { describe, expect, it, vi, afterEach } from 'vitest';
import { openWelcomeHelp } from '@/modules/navigation/helpAccess';
import { readFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());

describe('opening Help in a new tab from the welcome screen', () => {
  it('opens the extension page in a new tab and never navigates the welcome screen', async () => {
    const create = vi.fn().mockResolvedValue({});
    vi.stubGlobal('chrome', { runtime: { id: 'ext', getURL: (path: string) => `chrome-extension://test/${path}` }, tabs: { create } });
    expect(await openWelcomeHelp('/help')).toBe(true);
    expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://test/index.html#/help' });
    expect(await openWelcomeHelp('/help/articles/restore?basic=1')).toBe(true);
    expect(create).toHaveBeenLastCalledWith({ url: 'chrome-extension://test/index.html#/help/articles/restore?basic=1' });
    expect(await openWelcomeHelp('/blog/gerowallet-2-7-is-live')).toBe(true);
    expect(create).toHaveBeenLastCalledWith({ url: 'chrome-extension://test/index.html#/blog/gerowallet-2-7-is-live' });
  });

  it('reports a rejected tab creation instead of throwing', async () => {
    vi.stubGlobal('chrome', {
      runtime: { id: 'ext', getURL: (path: string) => path },
      tabs: { create: vi.fn().mockRejectedValue(new Error('Unavailable')) },
    });
    expect(await openWelcomeHelp('/help')).toBe(false);
  });

  it('reports an extension context without the tabs API', async () => {
    vi.stubGlobal('chrome', { runtime: { id: 'ext', getURL: (path: string) => path } });
    expect(await openWelcomeHelp('/help')).toBe(false);
  });

  it('uses window.open outside the extension and detaches the new window', async () => {
    const child = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(child);
    vi.stubGlobal('chrome', undefined);
    expect(await openWelcomeHelp('/help')).toBe(true);
    expect(open).toHaveBeenCalledWith(`${window.location.href.split('#')[0]}#/help`, '_blank');
    expect(child.opener).toBeNull();
    open.mockRestore();
  });

  it('treats a blocked window as a failure', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.stubGlobal('chrome', undefined);
    expect(await openWelcomeHelp('/help')).toBe(false);
    open.mockRestore();
    const throwing = vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('blocked'); });
    expect(await openWelcomeHelp('/help')).toBe(false);
    throwing.mockRestore();
  });
});

describe('welcome screen Help entry point', () => {
  const source = readFileSync('src/modules/welcome/views/Welcome.vue', 'utf8');
  const start = source.indexOf('class="language-selector-container"');
  const corner = source.slice(start, source.indexOf('</div>', start));

  it('replaces the two links with one toggle button beside the language selector, outside any wallet or setup branch', () => {
    expect(corner).toContain('aria-controls="whelp-panel"');
    expect(corner).toContain(':aria-expanded="helpOpen');
    expect(corner).toContain('toggleHelp()');
    expect(corner).toContain('<LanguageSelector />');
    expect(corner).not.toContain('enterHelp');
    expect(corner).not.toContain('help.contact');
    expect(corner).not.toContain('v-if=');
    expect(source.match(/<GButton/g)).toHaveLength(1);
  });

  it('no longer pushes the Help route or shows a page-level open failure', () => {
    expect(source).not.toContain('helpRouter');
    expect(source).not.toContain('helpOpenFailed');
    expect(source).not.toContain('welcome-help-error');
    expect(source).not.toContain('openWelcomeHelp');
  });
});
