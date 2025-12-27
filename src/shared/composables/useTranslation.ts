import { getCurrentInstance } from 'vue';/**
 * Composable for using translations in Composition API
 * @example
 * ```ts
 * import { useTranslation } from '@/shared/composables/useTranslation';
 *
 * const { t } = useTranslation();
 * const message = t('wallet.spendingPassword');
 * ```
 */
export function useTranslation() {
  // getCurrentInstance is auto-imported globally by unplugin-auto-import
  const instance = getCurrentInstance();

  const t = (key: string, params?: Record<string, any>): string => {
    if (!instance?.proxy.$t) {
      console.warn('Translation function not available');
      return key;
    }
    return (params ? instance.proxy.$t(key, params) : instance.proxy.$t(key)) as string;
  };

  const tc = (key: string, choice?: number, params?: Record<string, any>): string => {
    if (!instance?.proxy.$tc) {
      console.warn('Translation choice function not available');
      return key;
    }
    return instance.proxy.$tc(key, choice, params) as string;
  };

  return {
    t,
    tc,
  };
}

