import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useSubmitApiForm } from './useSubmitApiForm';
import type { SubmitApiConfig } from '@/shared/utils/submitApiConfig';

const SAVED: SubmitApiConfig = {
  version: 1,
  url: 'https://node.example/api/submit/tx',
  headerName: 'project_id',
  hasAuth: true,
  fallbackToDefault: true,
};

function setup(saved: SubmitApiConfig | null = SAVED) {
  const form = useSubmitApiForm(ref(saved), ref('Mainnet'));
  form.reset();
  return form;
}

describe('useSubmitApiForm', () => {
  it('starts from the saved config and keeps the saved secret by omitting headerValue', () => {
    const form = setup();
    expect(form.url.value).toBe(SAVED.url);
    expect(form.headerValueMode.value).toBe('saved');
    expect(form.canSubmit.value).toBe(true);
    const payload = form.payload(7);
    expect(payload).toEqual({ walletId: 7, url: SAVED.url, headerName: 'project_id', fallbackToDefault: true });
    expect('headerValue' in payload).toBe(false);
  });

  it('Remove drops the header name and sends headerValue null', () => {
    const form = setup();
    form.removeSavedValue();
    expect(form.payload(7)).toMatchObject({ headerName: null, headerValue: null });
    expect(form.canSubmit.value).toBe(true);
  });

  it('Replace sends the newly typed value', () => {
    const form = setup();
    form.replaceSavedValue();
    expect(form.canSubmit.value).toBe(false);
    form.headerValue.value = 'new-key';
    expect(form.payload(7)).toMatchObject({ headerName: 'project_id', headerValue: 'new-key' });
  });

  it('blocks a kept secret from following the URL to another origin', () => {
    const form = setup();
    form.url.value = 'https://other.example/api/submit/tx';
    expect(form.errorKey('headerValue')).toBe('settings.submitApi.errors.headerValueReenter');
    expect(form.canSubmit.value).toBe(false);
  });

  it('shows no URL error while the field is empty, but cannot submit', () => {
    const form = setup(null);
    expect(form.errorKey('url')).toBe('');
    expect(form.canSubmit.value).toBe(false);
  });

  it('maps a Nexus URL without the network to its i18n key', () => {
    const form = setup(null);
    form.url.value = 'https://nexus.gerowallet.io/api/transactions/submit';
    expect(form.errorKey('url')).toBe('settings.submitApi.errors.nexusNetwork');
  });
});
