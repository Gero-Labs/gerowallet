import { computed, ref, type Ref } from 'vue';
import {
  validateSubmitApiInput,
  type SubmitApiConfig,
  type SubmitApiErrorCode,
  type SubmitApiField,
} from '@/shared/utils/submitApiConfig';

/** saved: the stored secret is kept and never shown. edit: the field holds a new value. */
export type HeaderValueMode = 'saved' | 'edit';

export interface SubmitApiRequestPayload {
  walletId: number;
  url: string;
  headerName: string | null;
  /** Absent: keep the saved secret. null: remove it. string: replace it. */
  headerValue?: string | null;
  fallbackToDefault: boolean;
}

export function useSubmitApiForm(saved: Ref<SubmitApiConfig | null>, network: Ref<string>) {
  const url = ref('');
  const headerName = ref('');
  const headerValue = ref('');
  const headerValueMode = ref<HeaderValueMode>('edit');
  const fallbackToDefault = ref(false);

  function reset(): void {
    url.value = saved.value?.url ?? '';
    headerName.value = saved.value?.headerName ?? '';
    headerValue.value = '';
    headerValueMode.value = saved.value?.hasAuth ? 'saved' : 'edit';
    fallbackToDefault.value = saved.value?.fallbackToDefault ?? false;
  }

  function replaceSavedValue(): void {
    headerValueMode.value = 'edit';
    headerValue.value = '';
  }

  function removeSavedValue(): void {
    headerValueMode.value = 'edit';
    headerValue.value = '';
    headerName.value = '';
  }

  const savedOrigin = computed<string | null>(() => {
    try {
      return saved.value ? new URL(saved.value.url).origin : null;
    } catch {
      return null;
    }
  });

  const validation = computed(() => validateSubmitApiInput(
    {
      url: url.value,
      headerName: headerName.value,
      headerValue: headerValueMode.value === 'saved' ? undefined : headerValue.value,
      keepsSavedValue: headerValueMode.value === 'saved',
      savedOrigin: savedOrigin.value,
    },
    network.value,
  ));

  const canSubmit = computed(() => validation.value.normalized !== null);

  /** i18n key for the field's error, '' when fine. An untouched empty URL shows nothing. */
  function errorKey(field: SubmitApiField): string {
    if (field === 'url' && url.value.trim() === '') return '';
    const code: SubmitApiErrorCode | undefined = validation.value.errors[field];
    return code ? `settings.submitApi.errors.${code}` : '';
  }

  function payload(walletId: number): SubmitApiRequestPayload {
    const base = {
      walletId,
      url: url.value,
      headerName: headerName.value.trim() || null,
      fallbackToDefault: fallbackToDefault.value,
    };
    if (headerValueMode.value === 'saved') return base;
    return { ...base, headerValue: headerValue.value.trim() ? headerValue.value : null };
  }

  return {
    url,
    headerName,
    headerValue,
    headerValueMode,
    fallbackToDefault,
    validation,
    canSubmit,
    errorKey,
    payload,
    reset,
    replaceSavedValue,
    removeSavedValue,
  };
}
