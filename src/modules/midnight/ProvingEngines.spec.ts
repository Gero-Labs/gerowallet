// The "This computer" choices on the Proof server page: which are offered,
// what the browser prover card says, and how the speed comparison reads.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as Vue from 'vue';
import { defineComponent } from 'vue';

const fake = vi.hoisted(() => ({
  plan: { threads: 8 } as { threads: number; reason?: string },
  test: { proveMs: 1900, threads: 8 } as unknown,
  rows: [] as unknown[],
  fastest: null as string | null,
  run: undefined as unknown,
}));

vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, args?: Record<string, unknown>) => (args ? `${key}:${JSON.stringify(args)}` : key) }),
}));
vi.mock('@/chains/midnight/midnightZkirThreads', () => ({ threadedProvingPlan: () => fake.plan }));
vi.mock('@/chains/midnight/geroProverState', () => ({
  askBrowserSelfTest: vi.fn(async () => {
    if (fake.test instanceof Error) throw fake.test;
    return fake.test;
  }),
}));
vi.mock('@/chains/midnight/useProverSpeedTest', async () => {
  const { computed, ref } = await import('vue');
  return {
    useProverSpeedTest: () => ({
      rows: computed(() => fake.rows),
      run: (fake.run = vi.fn()),
      running: ref(false),
      fastest: computed(() => fake.fastest),
      slowestMs: computed(() => 8000),
      measured: computed(() => fake.rows.some((r) => (r as { state: { status: string } }).state.status === 'done')),
      plannedThreads: computed(() => 8),
    }),
  };
});

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import ProvingEngineChooser from './ProvingEngineChooser.vue';
// @ts-ignore: as above.
import BrowserProverCard from './BrowserProverCard.vue';
// @ts-ignore: as above.
import ProverSpeedCompare from './ProverSpeedCompare.vue';

const VBtnStub = defineComponent({
  render() {
    return Vue.h('button', { ...this.$attrs }, this.$slots['default']?.());
  },
});
const stubs = { 'v-icon': true, 'v-progress-circular': true, 'v-btn': VBtnStub };

beforeEach(() => {
  fake.plan = { threads: 8 };
  fake.test = { proveMs: 1900, threads: 8 };
  fake.rows = [];
  fake.fastest = null;
});

describe('ProvingEngineChooser', () => {
  const ids = (w: ReturnType<typeof mount>) => w.findAll('[role="radio"]').map((b) => b.attributes('data-testid'));

  it('offers the browser and the app only while each is on offer; Docker always', () => {
    const both = mount(ProvingEngineChooser, { props: { modelValue: 'browser', browserOffered: true, helperOffered: true }, global: { stubs } });
    expect(ids(both)).toEqual(['proving-engine-browser', 'proving-engine-helper', 'proving-engine-docker']);
    const helperOnly = mount(ProvingEngineChooser, { props: { modelValue: 'docker', browserOffered: false, helperOffered: true }, global: { stubs } });
    expect(ids(helperOnly)).toEqual(['proving-engine-helper', 'proving-engine-docker']);
  });

  it('marks the chosen one and emits a new choice', async () => {
    const w = mount(ProvingEngineChooser, { props: { modelValue: 'browser', browserOffered: true, helperOffered: true }, global: { stubs } });
    expect(w.find('[data-testid="proving-engine-browser"]').attributes('aria-checked')).toBe('true');
    expect(w.find('[data-testid="proving-engine-helper"]').attributes('aria-checked')).toBe('false');
    await w.find('[data-testid="proving-engine-helper"]').trigger('click');
    expect(w.emitted('update:modelValue')).toEqual([['helper']]);
  });
});

describe('BrowserProverCard', () => {
  it('says how many threads this browser will prove on', () => {
    const w = mount(BrowserProverCard, { global: { stubs } });
    const tile = w.find('[data-testid="browser-prover-threads"]').text();
    expect(tile).toContain('midnight.prover.browserThreads:{"n":8}');
    expect(tile).toContain('midnight.prover.browserThreadsHint');
    // The files a private send adds, from the pins.
    expect(w.text()).toContain('midnight.prover.megabytes:{"n":4}');
    expect(w.text()).toContain('midnight.prover.browserFilesHint:{"n":29}');
  });

  it('says so plainly when this browser can only prove on one thread', () => {
    fake.plan = { threads: 0, reason: 'no-shared-memory' };
    const w = mount(BrowserProverCard, { global: { stubs } });
    const tile = w.find('[data-testid="browser-prover-threads"]').text();
    expect(tile).toContain('midnight.prover.browserOneThread');
    expect(tile).toContain('midnight.prover.browserUnavailableBrowser');
  });

  it('a test proof reports its time, and corrects the thread count to what really ran', async () => {
    fake.test = { proveMs: 7600, threads: 1, threadsUnavailable: 'failed-to-start' };
    const w = mount(BrowserProverCard, { global: { stubs } });
    await w.find('[data-testid="browser-prover-test"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="browser-prover-test-result"]').text()).toBe('midnight.prover.browserTestOkOne:{"seconds":"7.6"}');
    const tile = w.find('[data-testid="browser-prover-threads"]').text();
    expect(tile).toContain('midnight.prover.browserOneThread');
    expect(tile).toContain('midnight.prover.browserUnavailableFailed');
  });

  it('a test proof that cannot be made says so', async () => {
    fake.test = new Error('worker stopped');
    const w = mount(BrowserProverCard, { global: { stubs } });
    await w.find('[data-testid="browser-prover-test"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="browser-prover-test-result"]').text()).toBe('midnight.prover.browserTestFailed');
  });
});

describe('ProverSpeedCompare', () => {
  it('before a run: every row says it is not measured, and the button offers to compare', () => {
    fake.rows = [{ id: 'standard', state: { status: 'idle' } }, { id: 'threaded', state: { status: 'idle' } }];
    const w = mount(ProverSpeedCompare, { props: { browserOffered: true, helperOffered: false }, global: { stubs } });
    expect(w.find('[data-testid="prover-speed-standard"]').text()).toContain('midnight.prover.speedNotRun');
    expect(w.find('[data-testid="prover-speed-run"]').text()).toBe('midnight.prover.speedRun');
    // No number is shown that this computer has not measured.
    expect(w.text()).not.toContain('midnight.send.provingElapsed');
  });

  it('after a run: this computer own times, the fastest marked, the rest named for what they are', async () => {
    fake.rows = [
      { id: 'standard', state: { status: 'done', ms: 7900, threads: 1 } },
      { id: 'threaded', state: { status: 'done', ms: 1900, threads: 8 } },
      { id: 'helper', state: { status: 'unavailable' } },
    ];
    fake.fastest = 'threaded';
    const w = mount(ProverSpeedCompare, { props: { browserOffered: true, helperOffered: true }, global: { stubs } });
    const threaded = w.find('[data-testid="prover-speed-threaded"]').text();
    expect(threaded).toContain('midnight.prover.speedThreaded:{"n":8}');
    expect(threaded).toContain('midnight.send.provingElapsed:{"n":"1.9"}');
    expect(threaded).toContain('midnight.prover.speedFastest');
    expect(w.find('[data-testid="prover-speed-standard"]').text()).toContain('midnight.send.provingElapsed:{"n":"7.9"}');
    expect(w.find('[data-testid="prover-speed-helper"]').text()).toContain('midnight.prover.speedNotSetUp');
    expect(w.find('[data-testid="prover-speed-run"]').text()).toBe('midnight.prover.speedRunAgain');
    await w.find('[data-testid="prover-speed-run"]').trigger('click');
    expect(fake.run).toHaveBeenCalledTimes(1);
  });
});
