// A rationale is a document on a host nobody in this codebase controls, so the
// only thing that says whether it is what the voter published is the
// blake2b-256 recorded on chain with the vote. Every assertion here is about
// that: the banner vouches ONLY when the hash matches, a document that cannot
// be vouched for is shown under an amber warning rather than hidden, and a
// document that never arrived shows a reason plus a way out to the browser.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';
import { blake2bHex } from 'blakejs';

// BaseDialog drags the whole Vuetify overlay stack in. What this file owns is
// the body it renders, so the shell is a plain div that exposes the slot.
// A render function, not a `template`: vitest runs the runtime-only Vue build,
// which compiles nothing at runtime (vue-test-utils compiles `stubs` templates
// itself, but a mocked module is not a stub).
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: {
    name: 'BaseDialog',
    props: ['isOpen', 'title', 'subtitle', 'icon', 'size', 'minHeight', 'height'],
    render(h: (tag: string, data: unknown, children: unknown) => unknown) {
      const self = this as unknown as { $slots: { default?: unknown } };
      return h('div', { class: 'base-dialog' }, self.$slots.default);
    },
  },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import RationaleDialog from './RationaleDialog.vue';

const CID_V1 = 'bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u';

const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const fetchMock = vi.fn();

/** A CIP-136 document plus the hash its own bytes actually produce. */
function document(body: Record<string, unknown>): { bytes: Uint8Array; hash: string } {
  const bytes = new TextEncoder().encode(JSON.stringify({ hashAlgorithm: 'blake2b-256', body }));
  // Hashed with blakejs directly rather than through the wallet's own helper, so
  // a change to that helper cannot silently agree with itself here.
  return { bytes, hash: blake2bHex(bytes, undefined, 32) };
}

/** A `Response` with only the three members the loader touches. */
function response(bytes: Uint8Array, options: { ok?: boolean; contentLength?: string } = {}) {
  return {
    ok: options.ok ?? true,
    headers: { get: (name: string) => (name === 'content-length' ? options.contentLength ?? null : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function render(props: Record<string, unknown>): Wrapper<Vue> {
  return mount(RationaleDialog, {
    propsData: { isOpen: true, ...props },
    mocks: { $t },
    stubs: { 'v-icon': true, 'v-skeleton-loader': true },
  });
}

/** Let the fetch and the hash settle. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await Vue.nextTick();
  await Vue.nextTick();
}

let wrapper: Wrapper<Vue> | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  vi.unstubAllGlobals();
});

describe('RationaleDialog', () => {
  it('renders the rationale once the bytes hash to what the vote recorded', async () => {
    const doc = document({
      summary: 'We voted no.',
      rationaleStatement: 'The **budget** exceeds the treasury cap.',
    });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: doc.hash });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.anchorVerified');
    expect(html).toContain('We voted no.');
    // Markdown is rendered, and the section keeps the label CIP-136 gives it.
    expect(html).toContain('<strong>budget</strong>');
    expect(html).toContain('dashboard.summary');
    expect(html).toContain('governance.rationale');
  });

  it('escapes an author who writes markup instead of prose', async () => {
    const doc = document({ comment: '<img src=x onerror=alert(1)>' });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: doc.hash });
    await settle();

    // renderMarkdown escapes before it applies a single rule, so the tag is
    // visible text and never an element.
    expect(wrapper.find('.g-prose').element.querySelector('img')).toBeNull();
    expect(wrapper.html()).toContain('&lt;img');
  });

  it('shows the text under an amber warning when the file does not match its hash', async () => {
    const doc = document({ comment: 'Rewritten after the vote.' });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: 'a'.repeat(64) });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.anchorMismatch');
    expect(html).toContain('governance.rationaleMismatchNote');
    expect(html).not.toContain('governance.anchorVerified');
    expect(wrapper.find('.rationale-dialog__banner--doubt').exists()).toBe(true);
    // The words are on screen, flagged — never vouched for, never hidden.
    expect(html).toContain('Rewritten after the vote.');
    expect(wrapper.find('.g-prose').exists()).toBe(true);
    // And the reader can still go and look for themselves.
    expect(wrapper.find('a').attributes('href')).toBe('https://author.test/r.json');
  });

  it('shows a document with no on-chain hash the same way, flagged as unverifiable', async () => {
    const doc = document({ comment: 'Nobody hashed this.' });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: null });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.rationaleNoHash');
    expect(html).toContain('governance.rationaleNoHashNote');
    expect(html).not.toContain('governance.anchorVerified');
    expect(html).toContain('Nobody hashed this.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still escapes markup in a document it could not verify', async () => {
    // The hash decides what the banner SAYS. It never decides whether the
    // author's bytes may reach the DOM as markup: they may not, in any state.
    const doc = document({ comment: '<img src=x onerror=alert(1)>' });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: 'a'.repeat(64) });
    await settle();

    expect(wrapper.find('.g-prose').element.querySelector('img')).toBeNull();
    expect(wrapper.html()).toContain('&lt;img');
  });

  it('pretty-prints a document that carries none of the CIP-136 prose fields', async () => {
    // An anchor is JSON by definition. One whose shape is unknown is shown as
    // the JSON it is — indented, as text — rather than reported as empty.
    const doc = document({ internalVote: { constitutional: 3, unconstitutional: 0 } });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: doc.hash });
    await settle();

    const pre = wrapper.find('.rationale-dialog__json');
    expect(pre.exists()).toBe(true);
    expect(pre.element.tagName).toBe('PRE');
    expect(pre.text()).toContain('"constitutional": 3');
    expect(pre.text()).toMatch(/\n {2}"body": \{\n {4}"internalVote"/);
    expect(wrapper.find('.g-prose').exists()).toBe(false);
    expect(wrapper.html()).toContain('governance.anchorVerified');
  });

  it('refuses an oversized document on its declared length, before reading a byte', async () => {
    const doc = document({ comment: 'x' });
    const arrayBuffer = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => String(2 * 1024 * 1024) },
      arrayBuffer,
    });

    wrapper = render({ url: 'https://author.test/r.json', hash: doc.hash });
    await settle();

    expect(wrapper.html()).toContain('governance.rationaleTooLarge');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('refuses a body that overruns the cap even when the header understated it', async () => {
    // A hostile host writes its own headers, so the declared length is a hint
    // and the arrived length is the bound. `rationaleDoc.spec.ts` pins the same
    // rule at the loader; this one proves the dialog reports it as oversize
    // rather than hashing half a megabyte of nothing.
    const bytes = new TextEncoder().encode('x'.repeat(600 * 1024));
    fetchMock.mockResolvedValue(response(bytes, { contentLength: '10' }));

    wrapper = render({ url: 'https://author.test/r.json', hash: 'b'.repeat(64) });
    await settle();

    expect(wrapper.html()).toContain('governance.rationaleTooLarge');
  });

  it('offers the browser when the wallet cannot reach the host at all', async () => {
    fetchMock.mockRejectedValue(new Error('blocked by connect-src'));

    wrapper = render({ url: 'https://author.test/r.json', hash: 'c'.repeat(64) });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.anchorFetchFailed');
    expect(html).toContain('governance.rationaleFetchFailedBody');
    expect(wrapper.find('a').attributes('href')).toBe('https://author.test/r.json');
  });

  it('fetches an ipfs anchor through the proxy and links out to a public gateway', async () => {
    const doc = document({ comment: 'From IPFS.' });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: `ipfs://${CID_V1}`, hash: doc.hash });
    await settle();

    expect(String(fetchMock.mock.calls[0][0])).toContain(`/api/ipfs?path=${CID_V1}`);
    // The link is for a real browser tab, where the gateway answers normally.
    expect(wrapper.find('a').attributes('href')).toBe(`https://ipfs.io/ipfs/${CID_V1}`);
  });

  it('carries an abort signal, so a host that never answers cannot hang the dialog', async () => {
    const doc = document({ comment: 'ok' });
    fetchMock.mockResolvedValue(response(doc.bytes));

    wrapper = render({ url: 'https://author.test/r.json', hash: doc.hash });
    await settle();

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    // No cookies and no cached copy: this is a read of a public document.
    expect(fetchMock.mock.calls[0][1].credentials).toBe('omit');
  });

  it('sends no request at all while it is closed', async () => {
    wrapper = render({ isOpen: false, url: 'https://author.test/r.json', hash: 'd'.repeat(64) });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
