// What this file protects is a claim about ABSENCE: the avatar must never be a
// broken-image glyph, and it must never be nothing at all. Half the DReps on
// mainnet publish an `ipfs://` image, which no browser resolves and no public
// gateway will serve to an extension origin, so before the mapping below their
// avatars simply did not appear — the bug that started this work.
import { describe, it, expect } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import DRepAvatar from './DRepAvatar.vue';
import { ipfsPathOf, toInAppUrl, toExternalHref } from '@/modules/governance/utils/govAnchor';

/** Real CIDs, so the CID parser is exercised rather than a stubbed one. */
const CID_V1 = 'bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u';
const CID_V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

function render(props: Record<string, unknown>): Wrapper<Vue> {
  return mount(DRepAvatar, { propsData: props, stubs: { 'v-icon': true } });
}

describe('DRepAvatar', () => {
  it('renders an http(s) image with no referrer attached', () => {
    const wrapper = render({ imageUrl: 'https://example.test/a.png', name: 'Meridian' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('https://example.test/a.png');
    // The host is third-party: it does not get to learn which wallet page the
    // request came from.
    expect(img.attributes('referrerpolicy')).toBe('no-referrer');
  });

  it('routes an ipfs:// image through the proxy instead of dropping it', () => {
    const img = render({ imageUrl: `ipfs://${CID_V1}`, name: 'Cardano Foundation' }).find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toContain(`/api/ipfs?path=${CID_V1}`);
  });

  it('falls back to the initial when there is no image at all', () => {
    const wrapper = render({ imageUrl: null, name: 'meridian collective' });
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.drep-avatar__initial').text()).toBe('M');
  });

  it('swaps the initial in when the hosted image fails, never a broken image', async () => {
    const wrapper = render({ imageUrl: 'https://example.test/gone.png', name: 'Meridian' });
    expect(wrapper.find('img').exists()).toBe(true);

    await wrapper.find('img').trigger('error');
    await Vue.nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.drep-avatar__initial').text()).toBe('M');
  });

  it('recovers when the DRep changes to one whose image does load', async () => {
    const wrapper = render({ imageUrl: 'https://example.test/gone.png', name: 'A' });
    await wrapper.find('img').trigger('error');
    await Vue.nextTick();
    expect(wrapper.find('img').exists()).toBe(false);

    // A stuck `broken` flag would leave every subsequent DRep on the fallback.
    wrapper.setProps({ imageUrl: 'https://example.test/ok.png', name: 'B' });
    await Vue.nextTick();
    expect(wrapper.find('img').exists()).toBe(true);
  });

  it('refuses a javascript: or data: contentUrl outright', () => {
    for (const hostile of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=']) {
      const wrapper = render({ imageUrl: hostile, name: 'Hostile' });
      expect(wrapper.find('img').exists()).toBe(false);
      expect(wrapper.find('.drep-avatar__initial').exists()).toBe(true);
    }
  });

  it('holds the same box in every state, so nothing on the row moves', () => {
    const withImage = render({ imageUrl: 'https://example.test/a.png', name: 'A', size: 40 });
    const withInitial = render({ imageUrl: null, name: 'A', size: 40 });
    const box = 'width: 40px; height: 40px;';
    expect(withImage.attributes('style')).toContain(box);
    expect(withInitial.attributes('style')).toContain(box);
  });

  it('takes the first WHOLE character of a name, emoji included', () => {
    expect(render({ name: '🦎 Lizard DRep' }).find('.drep-avatar__initial').text()).toBe('🦎');
  });

  it('shows a neutral glyph rather than an empty box when there is no name either', () => {
    const wrapper = render({ imageUrl: null, name: null });
    expect(wrapper.find('.drep-avatar__initial').exists()).toBe(false);
    expect(wrapper.html()).toContain('v-icon');
  });
});

// The two URLs the same input produces are DIFFERENT on purpose: one is loaded
// by the extension page, the other is handed to a browser tab.
describe('govAnchor', () => {
  it('extracts the CID from every spelling an author might publish', () => {
    expect(ipfsPathOf(`ipfs://${CID_V1}`)).toBe(CID_V1);
    expect(ipfsPathOf(`ipfs://ipfs/${CID_V0}`)).toBe(CID_V0);
    expect(ipfsPathOf(CID_V0)).toBe(CID_V0);
    expect(ipfsPathOf(`https://ipfs.io/ipfs/${CID_V1}`)).toBe(CID_V1);
    expect(ipfsPathOf(`https://${CID_V1}.ipfs.dweb.link/`)).toBe(CID_V1);
    expect(ipfsPathOf(`ipfs://${CID_V1}/logo.png`)).toBe(`${CID_V1}/logo.png`);
  });

  it('does not mistake an ordinary path containing /ipfs/ for content', () => {
    // The leading segment has to PARSE as a CID; the proxy cannot resolve a
    // filename, and re-pointing this URL would break a link that works today.
    expect(ipfsPathOf('https://example.test/ipfs/not-a-cid.png')).toBeNull();
    expect(toInAppUrl('https://example.test/ipfs/not-a-cid.png')).toBe(
      'https://example.test/ipfs/not-a-cid.png',
    );
  });

  it('sends IPFS through the proxy in-app and a public gateway outside', () => {
    expect(toInAppUrl(`ipfs://${CID_V1}`)).toContain(`/api/ipfs?path=${CID_V1}`);
    expect(toExternalHref(`ipfs://${CID_V1}`)).toBe(`https://ipfs.io/ipfs/${CID_V1}`);
  });

  it('returns null for anything that is not a web link or IPFS content', () => {
    for (const hostile of ['javascript:alert(1)', 'data:text/html,<script>', 'not a url', '']) {
      expect(toInAppUrl(hostile)).toBeNull();
      expect(toExternalHref(hostile)).toBeNull();
    }
  });
});
