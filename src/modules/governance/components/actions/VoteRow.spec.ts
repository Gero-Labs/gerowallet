// WCAG 2.2 target size (minimum) is 24x24 CSS px, and a vote row carries two
// controls that only just clear it: the voter name and the rationale control,
// both buttons rather than links because they open in-app, the latter with a
// short caption plus a tiny icon for visible content. Both floors are in the
// stylesheet, and nothing pinned them — a later tidy-up of the scoped styles
// could take either one back out and no test would notice.
//
// The floors are asserted against the component's OWN stylesheet rather than a
// computed style: vitest does not apply an SFC's scoped CSS in happy-dom, so a
// `getComputedStyle` assertion would read 0px and pass no matter what the file
// says. Each case first renders the control and reads its class off the DOM, so
// renaming the class breaks the pin instead of silently unhooking it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import VoteRow from './VoteRow.vue';
import type { PositionRow } from './positions';

// Read beside this spec, not via `new URL('./x', import.meta.url)`: the happy-dom
// environment resolves that against the document base and hands back an http: URL.
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'VoteRow.vue'), 'utf8');

const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

function row(over: Partial<PositionRow> = {}): PositionRow {
  return {
    key: 'row-1',
    role: 'DRep',
    id: `drep1${'q'.repeat(50)}`,
    credentialHex: 'aa'.repeat(28),
    committeeHex: null,
    committeeColdHex: null,
    drepId: `drep1${'q'.repeat(50)}`,
    vote: 'Yes',
    votedAt: 1787463005,
    hasRationale: true,
    rationaleUrl: 'https://example.test/why.json',
    rationaleHash: 'ab'.repeat(32),
    hasScript: false,
    isDRep: true,
    ...over,
  };
}

/** A real mainnet committee hot credential, and a real CID for the avatar mapping. */
const CC_HOT = '2ea7a78eb914d988b9d368ed88906f3bc9fc5421667dea6a366710ec';
const CID_V1 = 'bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u';

/** A committee row: no DRep credential, no profile route, its hot hash for an id. */
function committeeRow(over: Partial<PositionRow> = {}): PositionRow {
  return row({
    role: 'ConstitutionalCommittee',
    id: CC_HOT,
    credentialHex: null,
    committeeHex: CC_HOT,
    drepId: null,
    isDRep: false,
    hasRationale: false,
    rationaleUrl: null,
    rationaleHash: null,
    ...over,
  });
}

/** A row carrying both of its controls: a named, routable voter with a rationale. */
function mountRow(props: Record<string, unknown> = {}): Wrapper<Vue> {
  return mount(VoteRow, {
    mocks: { $t },
    propsData: { row: row(), name: 'CryptoCrow', route: { name: 'drep-detail' }, ...props },
    stubs: { 'v-icon': true },
  });
}

/** The declaration block of one rule in the component's scoped stylesheet. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(SOURCE);
  expect(match, `no CSS rule for ${selector}`).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

/** A px length that rule declares, or null when it declares none. Raising it is fine; dropping it is not. */
function pxOf(selector: string, property: string): number | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(\\d+)px`, 'm').exec(rule(selector));
  return match ? Number(match[1]) : null;
}

describe('VoteRow target size', () => {
  it('keeps a 24px floor on the height of the voter-name button', () => {
    const wrapper = mountRow();
    const name = wrapper.find('.vote-row__name--link');

    expect(name.exists()).toBe(true);
    // A button, so it is a tab stop and Enter/Space work with no key handler.
    expect(name.element.tagName).toBe('BUTTON');
    // The label makes it wider than 24px on its own; the height is what a
    // control styled like a text link otherwise lacks.
    expect(pxOf('.vote-row__name--link', 'min-height')).toBeGreaterThanOrEqual(24);
    wrapper.destroy();
  });

  it('keeps a 24px floor on both axes of the rationale button', () => {
    const wrapper = mountRow();
    const rationale = wrapper.find('.vote-row__rationale');

    expect(rationale.exists()).toBe(true);
    expect(rationale.element.tagName).toBe('BUTTON');
    expect(pxOf('.vote-row__rationale', 'min-height')).toBeGreaterThanOrEqual(24);
    // This one can shrink on both axes: its content is a short caption and an
    // x-small icon, so the width floor is load-bearing too.
    expect(pxOf('.vote-row__rationale', 'min-width')).toBeGreaterThanOrEqual(24);
    wrapper.destroy();
  });

  it('has no third control that would need a floor of its own', () => {
    // The pins above cover the row only while these are all of it. A control
    // added later fails here rather than shipping under the minimum unnoticed.
    const wrapper = mountRow();
    const controls = wrapper.findAll('button, a, input, select, textarea, [tabindex]');

    expect(controls).toHaveLength(2);
    expect(controls.at(0).classes()).toContain('vote-row__name--link');
    expect(controls.at(1).classes()).toContain('vote-row__rationale');
    wrapper.destroy();
  });

  it('renders the name as plain text, and no control at all, when nothing routes', () => {
    // The floor only has to hold where a control exists: an unnamed or
    // unroutable voter is text, not a 24px button with nothing behind it.
    const wrapper = mountRow({
      name: null,
      route: null,
      row: row({ hasRationale: false, rationaleUrl: null, rationaleHash: null }),
    });

    expect(wrapper.find('.vote-row__name--link').exists()).toBe(false);
    expect(wrapper.findAll('button, a')).toHaveLength(0);
    wrapper.destroy();
  });
});

// The slim layout: an avatar column, the id beside the name rather than under
// it, and a row height that can only come down because the two controls keep
// their own floors (pinned above).
describe('VoteRow layout', () => {
  it('reserves the avatar column on every row, decoratively', () => {
    const wrapper = mountRow();
    const avatar = wrapper.find('.vote-row__avatar');

    expect(avatar.exists()).toBe(true);
    // A placeholder standing in for a picture is not a control and carries no
    // name of its own, so assistive tech skips it rather than announcing it.
    expect(avatar.attributes('aria-hidden')).toBe('true');
    expect(avatar.element.tagName).toBe('SPAN');
    wrapper.destroy();
  });

  it('puts the id beside the name, on the same line', () => {
    const wrapper = mountRow();
    const identity = wrapper.find('.vote-row__identity');
    const name = identity.find('.vote-row__name');
    const id = identity.find('.vote-row__id');

    expect(name.exists()).toBe(true);
    expect(id.exists()).toBe(true);
    // Siblings in one flex line, which is what saves the second row of height.
    expect(id.element.parentElement).toBe(name.element.parentElement);
    expect(rule('.vote-row__identity')).not.toMatch(/flex-direction:\s*column/);
    wrapper.destroy();
  });

  it('does not repeat the id when the id IS the name', () => {
    // An unnamed voter shows its id in the name slot; a second copy beside it
    // would be the same string twice on one line.
    const wrapper = mountRow({ name: null, route: null });

    expect(wrapper.find('.vote-row__name').exists()).toBe(true);
    expect(wrapper.find('.vote-row__id').exists()).toBe(false);
    wrapper.destroy();
  });

  it('keeps the row slimmer than a panel row without dropping below the target floors', () => {
    const declarations = rule('.vote-row');
    const minHeight = /min-height:\s*var\(--g-row-h-table\)/.test(declarations);

    // The table row height (44px), not the panel one (48px). Asserted by token
    // rather than by number so the row keeps tracking the scale.
    expect(minHeight).toBe(true);
    // Still tall enough for the 24px controls plus their padding.
    expect(declarations).toMatch(/padding:\s*var\(--g-s-1\)/);
    expect(pxOf('.vote-row__name--link', 'min-height')).toBeGreaterThanOrEqual(24);
    expect(pxOf('.vote-row__rationale', 'min-height')).toBeGreaterThanOrEqual(24);
  });

  it('marks your own representative in words as well as in colour', () => {
    const wrapper = mountRow({ isYours: true });

    expect(wrapper.classes()).toContain('vote-row--yours');
    expect(wrapper.find('.vote-row__chip--yours').text()).toBe('governance.yours');
    wrapper.destroy();
  });

  // Every row carries a picture slot, whichever body the voter sits in. What
  // fills it is the one thing that must not be invented: a published image, the
  // initial of a published name, or the anonymous glyph.
  it('routes a published ipfs avatar through the proxy rather than dropping it', () => {
    // The index stores the URI as the DRep wrote it; DRepAvatar is the single
    // place that maps one. Before that, an ipfs:// avatar was filtered out one
    // layer up and the row showed the glyph despite having a picture.
    const wrapper = mountRow({ imageUrl: `ipfs://${CID_V1}` });
    const img = wrapper.find('.vote-row__avatar img');

    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toContain(`/api/ipfs?path=${CID_V1}`);
    wrapper.destroy();
  });

  it('gives a named committee member the same initial fallback as a DRep', () => {
    // The committee endpoint publishes no image, so a named member's avatar is
    // their initial — the same treatment a DRep with no picture gets, not a
    // second-class glyph.
    const wrapper = mountRow({
      row: committeeRow(),
      name: 'Tingvard',
      imageUrl: null,
      route: null,
    });

    expect(wrapper.find('.vote-row__avatar .drep-avatar__initial').text()).toBe('T');
    expect(wrapper.find('.vote-row__name').text()).toBe('Tingvard');
    wrapper.destroy();
  });

  it('leaves an unnamed committee member anonymous rather than inventing one', () => {
    const wrapper = mountRow({ row: committeeRow(), name: null, imageUrl: null, route: null });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.drep-avatar__initial').exists()).toBe(false);
    // The hash is what stands in, and it is the row's own.
    expect(wrapper.find('.vote-row__name').text()).toContain(CC_HOT.slice(0, 6));
    wrapper.destroy();
  });

  it('opens the rationale in-app, handing the row up rather than linking out', async () => {
    // The anchor is a JSON document; a raw link to it is unreadable. The row
    // emits, and the panel above mounts RationaleDialog for it.
    const wrapper = mountRow();
    await wrapper.find('.vote-row__rationale').trigger('click');

    expect(wrapper.emitted('rationale')?.[0]?.[0]).toMatchObject({
      rationaleUrl: 'https://example.test/why.json',
      rationaleHash: 'ab'.repeat(32),
    });
    expect(wrapper.find('.vote-row__rationale').attributes('href')).toBeUndefined();
    wrapper.destroy();
  });

  it('offers the rationale for an ipfs anchor too, since the dialog proxies it', () => {
    const wrapper = mountRow({ row: row({ rationaleUrl: 'ipfs://QmSomething' }) });
    expect(wrapper.find('.vote-row__rationale').exists()).toBe(true);
    wrapper.destroy();
  });

  it('renders the choice, the date and the rationale control in that order', () => {
    const wrapper = mountRow();
    const cells = wrapper.findAll('.vote-row > *');
    const classes = cells.wrappers.map(cell => cell.classes().join(' '));

    expect(classes.join(' | ')).toMatch(
      /vote-row__avatar.*vote-row__role.*vote-row__identity.*vote-row__pill.*vote-row__when.*vote-row__rationale/,
    );
    wrapper.destroy();
  });
});
