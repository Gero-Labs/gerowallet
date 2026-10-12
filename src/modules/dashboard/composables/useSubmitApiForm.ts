import { computed, ref, watch, type Ref } from 'vue';
import {
  submitApiPreset,
  submitApiProvider,
  validateSubmitApiInput,
  type SubmitApiConfig,
  type SubmitApiProviderChoice,
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

function originOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

/** The selector entry a URL belongs to; null while the URL is empty. */
function providerFor(rawUrl: string): SubmitApiProviderChoice | null {
  return rawUrl.trim() ? submitApiProvider(rawUrl) ?? 'custom' : null;
}

export function useSubmitApiForm(saved: Ref<SubmitApiConfig | null>, network: Ref<string>) {
  const url = ref('');
  const headerName = ref('');
  const headerValue = ref('');
  const headerValueMode = ref<HeaderValueMode>('edit');
  const fallbackToDefault = ref(false);
  /** The provider selector's choice. It follows the URL, so a pasted Blockfrost URL selects Blockfrost. */
  const provider = ref<SubmitApiProviderChoice | null>(null);

  watch(url, value => {
    const derived = providerFor(value);
    if (derived) provider.value = derived;
  });

  function reset(): void {
    url.value = saved.value?.url ?? '';
    // Nothing saved (or an unreadable row): Gero's own path is what this wallet uses.
    provider.value = saved.value ? providerFor(url.value) : 'default';
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

  const savedOrigin = computed<string | null>(() => (saved.value ? originOf(saved.value.url) : null));

  /** Fills the URL and header name the chosen provider expects on this wallet's network. */
  function selectProvider(choice: SubmitApiProviderChoice): void {
    const preset = submitApiPreset(choice, network.value);
    provider.value = choice;
    url.value = preset.url;
    headerName.value = preset.headerName;
    // OX Agent: Sensitive Data Protection prevented - a key typed for one provider is never sent to another
    headerValue.value = '';
    // The saved secret belongs to the saved origin: another provider needs its own key.
    if (headerValueMode.value === 'saved' && originOf(preset.url) !== savedOrigin.value) headerValueMode.value = 'edit';
  }

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
    provider,
    validation,
    canSubmit,
    errorKey,
    payload,
    reset,
    replaceSavedValue,
    removeSavedValue,
    selectProvider,
  };
}
