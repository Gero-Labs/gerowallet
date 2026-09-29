import { readyLanguageFor, type ReadyLanguage } from '@/plugins/i18n.config';

/**
 * The UI language a fresh install should start in: the browser's language when
 * we speak it, else null (keep the 'us' default).
 *
 * Only for `onInstalled` reason 'install'. On 'update' (or a Chrome update) an
 * existing user's 'us' may be a deliberate choice, so it is never changed.
 */
export function installLocaleFor(reason: string, uiLanguage: string | null | undefined): ReadyLanguage | null {
  if (reason !== 'install') return null;
  const detected = readyLanguageFor(uiLanguage);
  return detected === 'us' ? null : detected;
}
