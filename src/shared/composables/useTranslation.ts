import i18n from '@/plugins/i18n';

/** Shared translations track the composer's locale in computed/render effects. */
export function useTranslation() {
  return {
    t: (key: string, params?: Record<string, unknown>): string => i18n.t(key, params),
    tc: (key: string, choice?: number, params?: Record<string, unknown>): string => i18n.tc(key, choice, params),
  };
}
