import { describe, expect, it, vi, afterEach } from 'vitest';
import { openWelcomeHelp } from '@/modules/navigation/helpAccess';
import { readFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());
describe('welcome help entry', () => {
  it('preserves setup and reports missing or rejected tab creation without an unhandled rejection', async () => {
    const push = vi.fn();
    vi.stubGlobal('chrome', undefined);
    expect(await openWelcomeHelp(true, false, push)).toBe(false);
    vi.stubGlobal('chrome', { tabs: { create: vi.fn().mockRejectedValue(new Error('Unavailable')) }, runtime: { getURL: (path: string) => path } });
    expect(await openWelcomeHelp(true, true, push)).toBe(false);
    expect(push).not.toHaveBeenCalled();
    expect(await openWelcomeHelp(false, false, vi.fn().mockRejectedValue(new Error('Navigation failed')))).toBe(false);
  });
  it('opens another extension tab while setup remains mounted', async () => {
    const push = vi.fn();
    const create = vi.fn().mockResolvedValue({});
    vi.stubGlobal('chrome', { tabs: { create }, runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } });
    await openWelcomeHelp(true, true, push);
    expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://test/index.html#/help?support=1' });
    expect(push).not.toHaveBeenCalled();
  });
  it('uses ordinary public navigation before setup in either saved-wallet state', async () => {
    const push = vi.fn();
    await openWelcomeHelp(false, false, push);
    expect(push).toHaveBeenCalledWith('/help');
  });
  it('keeps both entry controls outside wallet and onboarding branches', () => {
    const source = readFileSync('src/modules/welcome/views/Welcome.vue', 'utf8');
    const chrome = source.slice(source.indexOf('class="language-selector-container"'), source.indexOf('<!-- Main container -->'));
    expect(chrome).toContain('enterHelp(false)');
    expect(chrome).toContain('enterHelp(true)');
    expect(chrome).not.toContain('v-if=');
  });
});
