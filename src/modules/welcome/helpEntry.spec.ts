import { describe, expect, it, vi, afterEach } from 'vitest';
import { openWelcomeHelp } from '@/modules/navigation/helpAccess';
import { readFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());
describe('welcome help entry', () => {
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
