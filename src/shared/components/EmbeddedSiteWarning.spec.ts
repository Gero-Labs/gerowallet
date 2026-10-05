import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import EmbeddedSiteWarning from './EmbeddedSiteWarning.vue';

const mountWith = (embeddedIn: unknown) => mount(EmbeddedSiteWarning, {
  propsData: { embeddedIn },
  mocks: { $t: (key: string, args: { site: string }) => `${key}:${args.site}` },
  stubs: { 'v-icon': true },
});

describe('EmbeddedSiteWarning', () => {
  it('names the embedding site when the request came from a cross-origin frame', () => {
    const w = mountWith('https://host.example');
    expect(w.find('[data-testid="embedded-site-warning"]').text()).toContain('miniGero.embeddedIn:https://host.example');
  });

  it('renders nothing for a top-level request or a malformed value', () => {
    for (const value of [null, undefined, '', 42, { site: 'x' }]) {
      expect(mountWith(value).find('[data-testid="embedded-site-warning"]').exists()).toBe(false);
    }
  });
});
