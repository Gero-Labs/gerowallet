import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import WcVerifyNotice from './WcVerifyNotice.vue';

const $t = (key: string, args?: { origin?: string }) => (args?.origin ? `${key}:${args.origin}` : key);
const mountWith = (verification: unknown) => mount(WcVerifyNotice, {
  props: { verification },
  global: { config: { globalProperties: mockGlobalProperties({ $t }) }, stubs: { 'v-icon': true } },
});
const notice = (verification: unknown) => mountWith(verification).find('[data-testid="wc-verify-notice"]');

describe('WcVerifyNotice', () => {
  it('labels a verified WalletConnect domain as such', () => {
    const text = notice({ state: 'verified', origin: 'https://app.minswap.org' }).text();
    expect(text).toContain('walletConnect.verify.via');
    expect(text).toContain('walletConnect.verify.verified');
    expect(text).not.toContain('walletConnect.verify.unverified');
  });

  it('warns when WalletConnect could not verify the domain', () => {
    const el = notice({ state: 'unverified' });
    expect(el.text()).toContain('walletConnect.verify.unverified');
    expect(el.attributes('role')).toBe('alert');
  });

  it('names the real origin on a mismatch', () => {
    expect(notice({ state: 'mismatch', origin: 'https://evil.example' }).find('[data-testid="wc-verify-mismatch"]').text())
      .toBe('walletConnect.verify.mismatch:https://evil.example');
    expect(notice({ state: 'mismatch' }).text()).toContain('walletConnect.verify.mismatchNoOrigin');
  });

  it('renders nothing for a request that did not come over WalletConnect', () => {
    for (const value of [undefined, null, {}, { state: 'trusted' }, 'verified']) {
      expect(notice(value).exists()).toBe(false);
    }
  });
});
