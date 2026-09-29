import { describe, expect, it } from 'vitest';
import { installLocaleFor } from './installLocale';

describe('installLocaleFor', () => {
  it('starts a fresh install in the browser language when it is ready', () => {
    expect(installLocaleFor('install', 'es-419')).toBe('es');
    expect(installLocaleFor('install', 'de-AT')).toBe('de');
  });

  it('keeps the default for English and for languages we do not speak yet', () => {
    expect(installLocaleFor('install', 'en-US')).toBeNull();
    expect(installLocaleFor('install', 'ja')).toBeNull();
    expect(installLocaleFor('install', undefined)).toBeNull();
  });

  it('never changes an existing user on update', () => {
    expect(installLocaleFor('update', 'es-419')).toBeNull();
    expect(installLocaleFor('chrome_update', 'es-419')).toBeNull();
    expect(installLocaleFor('shared_module_update', 'de')).toBeNull();
  });
});
