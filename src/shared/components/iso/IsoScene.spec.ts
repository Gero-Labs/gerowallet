import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IsoSceneSfc from './IsoScene.vue';

const IsoScene = IsoSceneSfc as unknown as Parameters<typeof mount>[0];

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }));
}

describe('IsoScene', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is still by default', () => {
    stubReducedMotion(false);
    const html = mount(IsoScene, { propsData: { name: 'hero' } }).html();
    expect(html).not.toContain('animateMotion');
  });

  it('moves when animated', () => {
    stubReducedMotion(false);
    const html = mount(IsoScene, { propsData: { name: 'hero', animated: true } }).html();
    expect(html).toContain('animateMotion');
    expect(html).toContain('stroke-dashoffset');
  });

  it('stays still for people who asked for reduced motion', () => {
    stubReducedMotion(true);
    const html = mount(IsoScene, { propsData: { name: 'hero', animated: true } }).html();
    expect(html).not.toContain('animateMotion');
    expect(html).not.toContain('<animate');
  });

  it('puts the real card artwork on the card and gives every instance its own gradient ids', () => {
    stubReducedMotion(false);
    const first = mount(IsoScene, { propsData: { name: 'hero' } }).html();
    const second = mount(IsoScene, { propsData: { name: 'hero' } }).html();
    expect(first).toContain('front_card_no_mcx2');
    expect(first).not.toContain('__CARD_IMG__');
    expect(first).not.toContain('__UID__');
    const id = (html: string) => /id="(g-iso-[a-z0-9]+)-/.exec(html)?.[1];
    expect(id(first)).toBeTruthy();
    expect(id(first)).not.toBe(id(second));
  });

  it('is hidden from assistive tech unless labelled', () => {
    stubReducedMotion(false);
    expect(mount(IsoScene, { propsData: { name: 'pin' } }).attributes('aria-hidden')).toBe('true');
    const labelled = mount(IsoScene, { propsData: { name: 'pin', label: 'Keypad' } });
    expect(labelled.attributes('role')).toBe('img');
    expect(labelled.attributes('aria-label')).toBe('Keypad');
  });
});
