import { getCurrentInstance } from 'vue';

/** Keep component unit tests' explicit translation/parameter assertions. */
export function useMockTranslation() {
  const vm = getCurrentInstance()!.proxy! as unknown as {
    $t: (key: string, params?: Record<string, unknown>) => string;
  };
  return {
    t: (key: string, params?: Record<string, unknown>) => vm.$t(key, params),
    tc: (key: string, count?: number, params?: Record<string, unknown>) =>
      vm.$t(key, { count, n: count, ...params }),
  };
}
