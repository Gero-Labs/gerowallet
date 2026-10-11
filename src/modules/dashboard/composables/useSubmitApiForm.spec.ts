import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
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

  describe('provider selector', () => {
    it('selects the provider of the saved URL, and Custom for any other host', () => {
      expect(setup().provider.value).toBe('custom');
      expect(setup({ ...SAVED, url: 'https://api.koios.rest/api/v1/submittx' }).provider.value).toBe('koios');
      expect(setup(null).provider.value).toBe('default');
    });

    it('fills the URL and header name for the wallet network', () => {
      const form = setup(null);
      form.selectProvider('blockfrost');
      expect(form.url.value).toBe('https://cardano-mainnet.blockfrost.io/api/v0/tx/submit');
      expect(form.headerName.value).toBe('project_id');
      expect(form.provider.value).toBe('blockfrost');
      expect(form.canSubmit.value).toBe(false); // the project ID is still missing
      form.headerValue.value = 'mainnetKEY';
      expect(form.canSubmit.value).toBe(true);
    });

    it('drops a typed key when switching provider, so it never goes to another host', () => {
      const form = setup(null);
      form.selectProvider('nexus');
      form.headerValue.value = 'nexus-key';
      form.selectProvider('blockfrost');
      expect(form.headerValue.value).toBe('');
      expect(form.payload(7)).toMatchObject({ headerName: 'project_id', headerValue: null });
    });

    it('asks for a new key instead of keeping the saved one for another provider', () => {
      const form = setup();
      expect(form.headerValueMode.value).toBe('saved');
      form.selectProvider('koios');
      expect(form.headerValueMode.value).toBe('edit');
      expect(form.payload(7)).toMatchObject({ url: 'https://api.koios.rest/api/v1/submittx', headerName: null, headerValue: null });
    });

    it('Default (Gero) clears the endpoint and lets go of a saved key', () => {
      const form = setup();
      form.selectProvider('default');
      expect(form.provider.value).toBe('default');
      expect(form.url.value).toBe('');
      expect(form.headerName.value).toBe('');
      expect(form.headerValueMode.value).toBe('edit');
    });

    it('Custom clears the URL and header for the user to fill in', () => {
      const form = setup(null);
      form.selectProvider('nexus');
      form.selectProvider('custom');
      expect(form.url.value).toBe('');
      expect(form.headerName.value).toBe('');
      expect(form.provider.value).toBe('custom');
    });

    it('follows a pasted URL', async () => {
      const form = setup(null);
      form.url.value = 'https://preprod.koios.rest/api/v1/submittx';
      await nextTick();
      expect(form.provider.value).toBe('koios');
      form.url.value = 'http://10.0.0.35:8090/api/submit/tx';
      await nextTick();
      expect(form.provider.value).toBe('custom');
    });
  });
});
