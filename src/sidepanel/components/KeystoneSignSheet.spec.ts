// The Keystone send flow's device round-trip can only be exercised by a human
// with the hardware. What CAN be pinned down is everything on either side of the
// device: that the sheet hands the SAME request to the QR encoder it was given,
// that it asks the scanner for the right UR type (transaction signing and CIP-8
// data signing answer with different ones), and that a device-shaped response
// reaches the parent unchanged.
import { describe, it, expect, vi } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';
import { UR } from '@keystonehq/keystone-sdk';
import { CardanoSignature } from '@keystonehq/bc-ur-registry-cardano';
import { parseSignature } from '@/shared/utils/keystone';
// @ts-ignore — tsconfig has no `*.vue` module shim (see SupportAuthPrompt.spec.ts).
import KeystoneSignSheet from './KeystoneSignSheet.vue';

const $t = (key: string): string => key;

// The children are imported directly by `<script setup>`, so they resolve from
// setup bindings rather than the component registry — `stubs` by name does not
// reach them and the real canvas/camera components render. Mock the modules
// instead, defining the stubs inside the factories (vi.mock is hoisted above
// every top-level binding, so a factory cannot close over one).
vi.mock('@/shared/components/AnimatedQRCode.vue', () => ({
  default: {
    name: 'AnimatedQRCodeStub',
    props: ['type', 'cbor', 'size', 'capacity'],
    render(h: (t: string, o: unknown) => unknown) {
      return h('div', { attrs: { 'data-qr-type': this.type, 'data-qr-cbor': this.cbor, 'data-qr-size': String(this.size) } });
    },
  },
}));
vi.mock('@/shared/components/AnimatedQRScanner.vue', () => ({
  default: {
    name: 'AnimatedQRScannerStub',
    props: ['urTypes', 'purpose', 'width', 'height'],
    render(h: (t: string, o: unknown) => unknown) {
      return h('div', { attrs: { 'data-ur-types': (this.urTypes || []).join(',') } });
    },
  },
}));

// $t is mocked to the identity, so buttons carry their i18n key as text. Index
// position would be brittle: the header close button is index 0.
function click(w: Wrapper<Vue>, label: string): Promise<void> {
  const btn = w.findAll('button').wrappers.find((b) => b.text().includes(label));
  if (!btn) throw new Error(`no button matching ${label}; saw: ${w.findAll('button').wrappers.map((b) => b.text()).join(' | ')}`);
  btn.trigger('click');
  return w.vm.$nextTick();
}

function mountSheet(props: Record<string, unknown> = {}): Wrapper<Vue> {
  return mount(KeystoneSignSheet, {
    propsData: { isOpen: true, keystoneType: 'cardano-sign-request', keystoneCbor: 'a1', ...props },
    mocks: { $t },
    stubs: {
      'v-bottom-sheet': { template: '<div><slot /></div>' },
      'v-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
      'v-icon': true,
    },
  });
}

describe('KeystoneSignSheet', () => {
  it('renders the QR from exactly the request it was handed', () => {
    const w = mountSheet({ keystoneType: 'cardano-sign-request', keystoneCbor: 'deadbeef' });
    const qr = w.find('[data-qr-type]');
    expect(qr.attributes('data-qr-type')).toBe('cardano-sign-request');
    expect(qr.attributes('data-qr-cbor')).toBe('deadbeef');
  });

  it('asks the scanner for cardano-signature by default (transaction signing)', async () => {
    const w = mountSheet();
    await click(w, 'common.next');
    expect(w.find('[data-ur-types]').attributes('data-ur-types')).toBe('cardano-signature');
  });

  it('asks for cardano-sign-data-signature when the caller is doing CIP-8 data signing', async () => {
    const w = mountSheet({ urTypes: ['cardano-sign-data-signature'] });
    await click(w, 'common.next');
    expect(w.find('[data-ur-types]').attributes('data-ur-types')).toBe('cardano-sign-data-signature');
  });

  it('returns to the QR step on Back rather than closing, and closes from the QR step', async () => {
    const w = mountSheet();
    await click(w, 'common.next');
    expect(w.find('[data-ur-types]').exists()).toBe(true);

    await click(w, 'common.back');
    expect(w.find('[data-qr-type]').exists()).toBe(true);
    expect(w.emitted('close')).toBeFalsy();

    await click(w, 'common.cancel');
    expect(w.emitted('close')).toBeTruthy();
  });

  it('reopens on the QR step after a programmatic close', async () => {
    // SendSheet keeps this component mounted and closes it by flipping the prop
    // (after a successful scan, and on every error path), so handleClose never
    // runs. Without a reset the next send opens straight on the camera with no
    // QR for the device to read.
    const w = mountSheet();
    await click(w, 'common.next');
    expect(w.find('[data-ur-types]').exists()).toBe(true);

    w.setProps({ isOpen: false });
    await w.vm.$nextTick();
    w.setProps({ isOpen: true });
    await w.vm.$nextTick();

    expect(w.find('[data-qr-type]').exists()).toBe(true);
  });

  it('passes a scanned UR through to the parent untouched', async () => {
    const w = mountSheet();
    const scanned = { type: 'cardano-signature', cbor: 'aa' };
    await click(w, 'common.next'); // the scanner only exists on the scan step
    w.findComponent({ name: 'AnimatedQRScannerStub' }).vm.$emit('scan', scanned);
    expect(w.emitted('scan')?.[0]?.[0]).toBe(scanned);
  });
});

describe('device response parsing (what the send flow does with a scan)', () => {
  it('recovers the witness set from a device-shaped cardano-signature UR', () => {
    // Stand in for the device: a real CardanoSignature carrying a known witness set.
    const requestId = Buffer.from('9b1deb4d3b7d4bad9bdd2b0d7b3dcb6d', 'hex');
    const witnessSetHex = 'a10081825820' + '11'.repeat(32) + '5840' + '22'.repeat(64);
    const sig = new CardanoSignature(Buffer.from(witnessSetHex, 'hex'), requestId);
    const ur = new UR(sig.toCBOR(), 'cardano-signature');

    const parsed = parseSignature(ur as unknown as UR);

    // SendSheet.onKeystoneScan guards on exactly these two properties before it
    // will submit, so assert the shape it checks, not just the value.
    expect(typeof parsed.witnessSet).toBe('string');
    expect(parsed.witnessSet).toBe(witnessSetHex);
  });
});
