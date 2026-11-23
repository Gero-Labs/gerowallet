// The Gero Prover card on the Proof server page, in each state the helper can
// be in. The helper itself is the fake of midnightHelperProver.spec.ts; here the
// background's answers are given directly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as Vue from 'vue';
import { defineComponent } from 'vue';
import type { GeroProverSnapshot, HelperStatus } from '@/chains/midnight/midnightHelperProtocol';

const bg = vi.hoisted(() => ({
  /** What the background answers a status read with. */
  snapshot: { connection: 'not-allowed' } as unknown,
  selfTest: undefined as unknown,
  selfTestError: undefined as string | undefined,
  asked: [] as unknown[],
}));
let store = vi.hoisted(() => ({ provingHistory: [] as unknown[] }));

vi.mock('@/chains/midnight/geroProverState', async () => {
  const { ref } = await import('vue');
  const geroProverSnapshot = ref<unknown>(null);
  const refreshGeroProver = vi.fn(async () => {
    geroProverSnapshot.value = bg.snapshot;
    return bg.snapshot;
  });
  return {
    geroProverSnapshot,
    refreshGeroProver,
    helperErrorCopyKey: (error?: string) => (error === 'GERO_PROVER_TIMEOUT' ? 'midnight.prover.error.timeout' : undefined),
    askGeroProver: vi.fn(async (request: { action: string; enabled?: boolean }) => {
      bg.asked.push(request);
      if (request.action === 'selfTest' && bg.selfTestError) throw new Error(bg.selfTestError);
      if (request.action === 'setAccelerator') {
        const current = bg.snapshot as { status: HelperStatus };
        bg.snapshot = {
          ...current,
          status: { ...current.status, accelerator: { ...current.status.accelerator, enabled: !!request.enabled, state: request.enabled ? 'active' : 'off' } },
        };
      }
      geroProverSnapshot.value = bg.snapshot;
      return { snapshot: bg.snapshot, selfTest: request.action === 'selfTest' ? bg.selfTest : undefined };
    }),
  };
});
vi.mock('@/stores/midnightStore', () => ({ midnightStore: (store = Vue.reactive(store)) }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, args?: Record<string, unknown>) => (args ? `${key}:${JSON.stringify(args)}` : key) }),
}));
vi.mock('@/shared/utils/relativeTime', () => ({ formatRelativeTime: () => '4m ago' }));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import GeroProverCard from './GeroProverCard.vue';

const VBtnStub = defineComponent({
  render() {
    return Vue.h('button', { ...this.$attrs }, this.$slots['default']?.());
  },
});
const VSwitchStub = defineComponent({
  props: { modelValue: Boolean, disabled: Boolean },
  emits: ['update:modelValue'],
  render() {
    return Vue.h('input', {
      type: 'checkbox',
      checked: this.modelValue,
      disabled: this.disabled,
      onChange: (event: Event) => this.$emit('update:modelValue', (event.target as HTMLInputElement).checked),
    });
  },
});

const status = (accelerator: Partial<HelperStatus['accelerator']>, files = 4): HelperStatus => ({
  accelerator: { enabled: true, state: 'active', gpuOps: 3, cpuOps: 1, ...accelerator },
  keys: { files, bytes: files ? 3_753_065 : 0 },
  threads: 8,
});
const connected = (accelerator: Partial<HelperStatus['accelerator']> = {}, files = 4): GeroProverSnapshot => ({
  connection: 'connected', version: '1.0.0', os: 'macos', status: status(accelerator, files),
});

let permission = { granted: false, request: vi.fn(async () => true) };

async function mountCard(snapshot: GeroProverSnapshot, granted: boolean) {
  bg.snapshot = snapshot;
  permission.granted = granted;
  const wrapper = mount(GeroProverCard, {
    global: { stubs: { 'v-icon': true, 'v-progress-circular': true, 'v-btn': VBtnStub, 'v-switch': VSwitchStub } },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  bg.asked = [];
  bg.selfTest = undefined;
  bg.selfTestError = undefined;
  store.provingHistory = [];
  permission = { granted: false, request: vi.fn(async () => { permission.granted = true; return true; }) };
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn(async () => permission.granted),
      request: (...args: unknown[]) => (permission.request as (...a: unknown[]) => Promise<boolean>)(...args),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Gero Prover card', () => {
  it('first time: three steps, and Allow asks the browser for the one permission', async () => {
    const w = await mountCard({ connection: 'not-allowed' }, false);
    expect(w.attributes('data-view')).toBe('setup');
    expect(w.text()).toContain('midnight.prover.step1Title');
    expect(w.text()).toContain('midnight.prover.step2Title');
    expect(w.text()).toContain('midnight.prover.step3Title');
    // The browser cannot look for the helper before it is allowed to.
    expect(w.find('[data-testid="gero-prover-waiting"]').exists()).toBe(false);
    // No release is published in this build, so there is no download link to a guess.
    expect(w.find('[data-testid="gero-prover-download"]').exists()).toBe(false);

    bg.snapshot = { connection: 'not-found' };
    await w.find('[data-testid="gero-prover-allow"]').trigger('click');
    await flushPromises();
    expect(permission.request).toHaveBeenCalledWith({ permissions: ['nativeMessaging'] });
    // Allowed, and no helper registered yet: waiting on "Open it once".
    expect(w.find('[data-testid="gero-prover-allow"]').exists()).toBe(false);
    expect(w.find('[data-testid="gero-prover-waiting"]').text()).toContain('midnight.prover.waiting');
  });

  it('setup offers the Docker proof server instead', async () => {
    const w = await mountCard({ connection: 'not-found' }, true);
    await w.find('[data-testid="gero-prover-use-docker"]').trigger('click');
    expect(w.emitted('use-docker')).toHaveLength(1);
  });

  it('connected with a graphics processor: says so, names the device, and the switch is on', async () => {
    store.provingHistory = [
      { timestamp: 5, durationMs: 400, success: true },
      { timestamp: 4, durationMs: 1140, success: true, processor: 'gpu' },
    ];
    const w = await mountCard(connected({ device: 'Apple M3 Pro' }), true);
    expect(w.attributes('data-view')).toBe('connected');
    expect(w.find('[data-testid="gero-prover-pill"]').text()).toContain('midnight.proofServerPage.statusDetectedShort');
    const processor = w.find('[data-testid="gero-prover-processor"]').text();
    expect(processor).toContain('midnight.prover.gpu');
    expect(processor).toContain('midnight.prover.gpuHintNamed:{"device":"Apple M3 Pro"}');
    const toggle = w.find('[data-testid="gero-prover-gpu-switch"]').element as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    // "Last proof" is the helper's own newest row, not another prover's.
    expect(w.text()).toContain('midnight.send.provingElapsed:{"n":"1.1"}');
    expect(w.text()).toContain('midnight.prover.megabytes:{"n":4}');
    expect(w.text()).toContain('midnight.prover.footer:{"version":"1.0.0"}');
    expect(w.find('[data-testid="gero-prover-tripped"]').exists()).toBe(false);
  });

  it('connected, main processor only: says why, and the switch cannot be turned on', async () => {
    const w = await mountCard(connected({ state: 'no-device' }), true);
    const processor = w.find('[data-testid="gero-prover-processor"]').text();
    expect(processor).toContain('midnight.prover.cpu');
    expect(processor).toContain('midnight.prover.cpuOnlyHint');
    const toggle = w.find('[data-testid="gero-prover-gpu-switch"]').element as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
  });

  it('graphics processor tripped: paused note, and "Turn back on" switches it on again', async () => {
    const w = await mountCard(connected({ state: 'tripped', device: 'Apple M3 Pro' }), true);
    expect(w.find('[data-testid="gero-prover-tripped"]').text()).toContain('midnight.prover.trippedTitle');
    expect(w.find('[data-testid="gero-prover-processor"]').text()).toContain('midnight.prover.cpu');
    await w.find('[data-testid="gero-prover-turn-on"]').trigger('click');
    await flushPromises();
    expect(bg.asked).toEqual([{ action: 'setAccelerator', enabled: true }]);
    expect(w.find('[data-testid="gero-prover-tripped"]').exists()).toBe(false);
    expect(w.find('[data-testid="gero-prover-processor"]').text()).toContain('midnight.prover.gpu');
  });

  it('helper missing after setup: back to the steps, waiting for it', async () => {
    const w = await mountCard({ connection: 'not-found' }, true);
    expect(w.attributes('data-view')).toBe('setup');
    expect(w.find('[data-testid="gero-prover-waiting"]').exists()).toBe(true);
    expect(w.find('[data-testid="gero-prover-allow"]').exists()).toBe(false);
  });

  it('helper cannot be started: says so and offers to try again', async () => {
    const w = await mountCard({ connection: 'error' }, true);
    expect(w.attributes('data-view')).toBe('error');
    expect(w.find('[data-testid="gero-prover-problem"]').text()).toContain('midnight.prover.notConnectedTitle');
    bg.snapshot = connected();
    await w.find('[data-testid="gero-prover-retry"]').trigger('click');
    await flushPromises();
    expect(w.attributes('data-view')).toBe('connected');
  });

  it('wrong version: names the release that answered and asks for an update', async () => {
    const w = await mountCard({ connection: 'wrong-version', version: '0.9.4' }, true);
    expect(w.attributes('data-view')).toBe('wrongVersion');
    const problem = w.find('[data-testid="gero-prover-problem"]').text();
    expect(problem).toContain('midnight.prover.wrongVersionTitle');
    expect(problem).toContain('midnight.prover.wrongVersionBody:{"version":"0.9.4"}');
    // Nothing to switch or test on a helper this build will not prove with.
    expect(w.find('[data-testid="gero-prover-test"]').exists()).toBe(false);
  });

  it('a test proof reports its time and processor', async () => {
    const w = await mountCard(connected(), true);
    bg.selfTest = { proveMs: 1180, accelerated: true };
    await w.find('[data-testid="gero-prover-test"]').trigger('click');
    await flushPromises();
    expect(bg.asked).toEqual([{ action: 'selfTest' }]);
    expect(w.find('[data-testid="gero-prover-test-result"]').text()).toBe('midnight.prover.testOkGpu:{"seconds":"1.2"}');
  });

  it('a test proof that fails says why, in one line', async () => {
    const w = await mountCard(connected(), true);
    bg.selfTestError = 'GERO_PROVER_TIMEOUT';
    await w.find('[data-testid="gero-prover-test"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="gero-prover-test-result"]').text())
      .toBe('midnight.prover.testFailed:{"reason":"midnight.prover.error.timeout"}');
  });
});
