// The "What's new" tab renders Gero's GitHub release notes through the wallet's
// escape-first renderMarkdown (it replaced showdown + DOMPurify, issue 1314).
// The notes come from Gero's backend, but a compromised or crafted release body
// must still never reach the options page as markup.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import { i18nPlugin } from '@/plugins/i18n';

const fetchReleases = vi.fn();
vi.mock('@/api/crypto-api', () => ({ default: { fetchReleases: (page: number) => fetchReleases(page) } }));

// BaseDialog is a v-dialog (teleported); a plain wrapper keeps the content in the test's DOM.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: {
    props: ['isOpen'],
    template: '<div v-if="isOpen" data-test="dialog"><slot /></div>',
  },
}));

import ChangeLogDialog from './ChangeLogDialog.vue';

enableAutoUnmount(afterEach);

async function mountWith(body: string) {
  fetchReleases.mockResolvedValue({
    status: 200,
    data: { content: [{ name: 'v2.8.0', body, publishedAt: '2026-11-01T00:00:00Z', tagName: 'v2.8.0' }] },
  });
  const wrapper = mount(ChangeLogDialog, {
    props: { isOpen: true },
    global: { plugins: [createTestVuetify(), i18nPlugin] },
  });
  await flushPromises();
  return wrapper;
}

describe('ChangeLogDialog release notes', () => {
  it('renders the markdown constructs that release notes use', async () => {
    const wrapper = await mountWith(
      '## 🔒 Security Hardening\n\n- **Critical fix**: unlock in `TransactionAuthSection`\n- See [the guide](https://gerowallet.io/guide)',
    );
    const notes = wrapper.find('.g-prose');
    expect(notes.find('.md-h.md-h2').text()).toBe('🔒 Security Hardening');
    expect(notes.find('li strong').text()).toBe('Critical fix');
    expect(notes.find('li code').text()).toBe('TransactionAuthSection');
    const link = notes.find('a');
    expect(link.attributes('href')).toBe('https://gerowallet.io/guide');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
  });

  it('shows raw HTML in a release body as text, never as markup', async () => {
    const wrapper = await mountWith('<img src=x onerror=alert(1)> <script>bad()</script> [x](javascript:alert(1))');
    const notes = wrapper.find('.g-prose');
    expect(notes.find('img').exists()).toBe(false);
    expect(notes.find('script').exists()).toBe(false);
    expect(notes.find('a').exists()).toBe(false);
    expect(notes.text()).toContain('<img src=x onerror=alert(1)>');
  });
});
