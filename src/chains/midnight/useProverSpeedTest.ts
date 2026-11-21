/**
 * "Speed on this computer": the same test proof (a DUST fee proof from a
 * throwaway key, midnightProverSelfTestFixture.ts) made by each way of proving
 * on this computer, so the choice between them rests on this machine's own
 * numbers and not on anyone's benchmark. Nothing leaves the computer.
 *
 * The rows are measured one after another: two provers at once would share the
 * processor and both read slow.
 */
import { computed, ref } from 'vue';
import { askBrowserSelfTest, askGeroProver, geroProverSnapshot } from './geroProverState';
import { threadedProvingPlan } from './midnightZkirThreads';

export type SpeedRowId = 'standard' | 'threaded' | 'helper';

export type SpeedRowState =
  | { status: 'idle' }
  | { status: 'running' }
  /** `threads`: what the prover reported, which for `threaded` may be 1 when it fell back. */
  | { status: 'done'; ms: number; threads?: number }
  /** Not available here: the helper is not set up, or this browser cannot run threads. */
  | { status: 'unavailable' }
  | { status: 'failed' };

export interface SpeedRow {
  id: SpeedRowId;
  state: SpeedRowState;
}

/** Shared by every mounted panel in this page, so a result stays while the user moves around. */
const results = ref<Record<SpeedRowId, SpeedRowState>>({
  standard: { status: 'idle' },
  threaded: { status: 'idle' },
  helper: { status: 'idle' },
});
const running = ref(false);

export function resetProverSpeedTestForTests(): void {
  results.value = { standard: { status: 'idle' }, threaded: { status: 'idle' }, helper: { status: 'idle' } };
  running.value = false;
}

export function useProverSpeedTest(offers: () => { browser: boolean; helper: boolean }) {
  /** Threads the browser prover would use here; 0 when it cannot run threads. */
  const plannedThreads = computed(() => threadedProvingPlan(globalThis.navigator?.hardwareConcurrency).threads);

  const rows = computed<SpeedRow[]>(() => {
    const offered = offers();
    const list: SpeedRow[] = [{ id: 'standard', state: results.value.standard }];
    if (offered.browser) list.push({ id: 'threaded', state: results.value.threaded });
    if (offered.helper) list.push({ id: 'helper', state: results.value.helper });
    return list;
  });

  const set = (id: SpeedRowId, state: SpeedRowState) => { results.value = { ...results.value, [id]: state }; };

  async function measureBrowser(id: 'standard' | 'threaded') {
    set(id, { status: 'running' });
    try {
      // A first proof also loads the prover and its keys; the second is the prover's own speed.
      await askBrowserSelfTest(id === 'threaded');
      const test = await askBrowserSelfTest(id === 'threaded');
      // Asked for threads and proved on one: this browser cannot run them, and the row would repeat the standard one.
      if (id === 'threaded' && test.threads <= 1) set(id, { status: 'unavailable' });
      else set(id, { status: 'done', ms: test.proveMs, threads: test.threads });
    } catch {
      set(id, { status: 'failed' });
    }
  }

  async function measureHelper() {
    if (geroProverSnapshot.value?.connection !== 'connected') {
      set('helper', { status: 'unavailable' });
      return;
    }
    set('helper', { status: 'running' });
    try {
      await askGeroProver({ action: 'selfTest' });
      const { selfTest } = await askGeroProver({ action: 'selfTest' });
      set('helper', selfTest ? { status: 'done', ms: selfTest.proveMs } : { status: 'failed' });
    } catch {
      set('helper', geroProverSnapshot.value?.connection === 'connected' ? { status: 'failed' } : { status: 'unavailable' });
    }
  }

  async function run() {
    if (running.value) return;
    running.value = true;
    try {
      for (const row of rows.value) {
        if (row.id === 'helper') await measureHelper();
        else await measureBrowser(row.id);
      }
    } finally {
      running.value = false;
    }
  }

  /** The quickest measured row, when at least two were measured. */
  const fastest = computed<SpeedRowId | null>(() => {
    const done = rows.value.filter((row) => row.state.status === 'done') as Array<SpeedRow & { state: { status: 'done'; ms: number } }>;
    if (done.length < 2) return null;
    return done.reduce((best, row) => (row.state.ms < best.state.ms ? row : best)).id;
  });

  /** The slowest measured time, which the bars are drawn against. */
  const slowestMs = computed(() => rows.value.reduce(
    (max, row) => (row.state.status === 'done' ? Math.max(max, row.state.ms) : max), 0,
  ));

  const measured = computed(() => rows.value.some((row) => row.state.status === 'done'));

  return { rows, run, running, fastest, slowestMs, measured, plannedThreads };
}
