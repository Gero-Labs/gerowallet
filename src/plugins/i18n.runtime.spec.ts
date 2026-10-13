// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import i18n, { loadLanguage, updateI18nLocale } from './i18n';

beforeEach(() => { i18n.locale = 'us'; });
describe('precompiled production locale runtime', () => {
  it('renders explicit-locale worker messages without a DOM', async () => {
    expect(typeof document).toBe('undefined');
    await import('@/chrome/backgroundLocales');
    for (const locale of ['us', 'de', 'es']) {
      const message = i18n.t('common.extensionUpdatedMessage', locale, { version: '9.9.9' });
      expect(message).toContain('9.9.9');
      expect(message).not.toBe('common.extensionUpdatedMessage');
    }
    expect(i18n.locale).toBe('us');
  });
  it.each(['us', 'de', 'es'])('preserves literal email, Lightning and plural interpolation in %s', async (locale) => {
    await loadLanguage(locale);
    i18n.locale = locale;
    expect(i18n.t('help.notice.noWallets')).toContain('support@gerowallet.io');
    expect(i18n.t('lightning.inputPlaceholder')).toContain('user@domain.com');
    expect(i18n.t('lightning.lightningExplainer')).toContain('user@domain.com');
    expect(i18n.tc('miniGero.pendingRequestCount', 2, { count: 2 })).toContain('2');
  });
  it('does not silently load an unsupported catalog or reverse a newer language choice', async () => {
    await expect(loadLanguage('xx')).rejects.toThrow('Unsupported locale');
    await Promise.all([updateI18nLocale('de'), updateI18nLocale('es')]);
    expect(i18n.locale).toBe('es');
  });
});
