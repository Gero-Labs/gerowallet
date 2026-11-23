// The send timeline while Gero Prover (the desktop helper) makes the proof.
import * as Vue from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/midnightStore', async () => {
  const { reactive } = await import('vue');
  return { midnightStore: reactive({ sendProgress: null as null | { phase: string; percent?: number } }) };
});

import { midnightStore } from '@/stores/midnightStore';
import { useMidnightSendTimeline, type SendTimelineLabels, type TimelineNode } from './useMidnightSendTimeline';
import { provingDetail, provingStepOf } from './useProvingElapsed';

const labels: SendTimelineLabels = {
  authorize: 'Authorize', build: 'Build', sync: 'Sync', sign: 'Sign', submit: 'Submit',
  provingDevice: 'Proving on this device', provingHelper: 'Proving on this computer',
  provingLocal: 'Proving locally', provingZkpaas: 'Proving via Arkhia', provingCloud: 'Proving with Gero Cloud',
};
const t = (key: string, params?: Record<string, unknown>) => (key === 'midnight.send.provingElapsed' ? `${params?.['n']} s` : key);

let apps: Vue.App[] = [];
function mountTimeline(stage: Vue.Ref<string>, helperProcessor: () => string | undefined, withLabels = labels) {
  let nodes!: Vue.ComputedRef<TimelineNode[]>;
  const app = Vue.createApp({
    setup() {
      nodes = useMidnightSendTimeline(Vue.computed(() => stage.value as never), Vue.computed(() => withLabels), {
        provingDetailFor: (step, seconds) => provingDetail(step, seconds, t, { helperProcessor: helperProcessor() }),
      });
      return {};
    },
    render: () => Vue.h('div'),
  });
  app.mount(document.createElement('div'));
  apps.push(app);
  return (key: string) => nodes.value.find((n) => n.key === key)!;
}

beforeEach(() => { vi.useFakeTimers(); (midnightStore as { sendProgress: unknown }).sendProgress = null; });
afterEach(() => { for (const a of apps) a.unmount(); apps = []; vi.useRealTimers(); });

describe('send timeline: proving with Gero Prover', () => {
  it('is a proving step of its own, on the sign node', () => {
    expect(provingStepOf('provingHelper', false)).toEqual({ node: 'sign', prover: 'helper' });
  });

  it('says "on this computer", counts the seconds and names the processor', async () => {
    const node = mountTimeline(Vue.ref('provingHelper'), () => 'Graphics processor · Apple M3 Pro');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(node('sign')).toMatchObject({
      label: 'Proving on this computer', state: 'active', percent: null, elapsed: '1 s', hint: 'Graphics processor · Apple M3 Pro',
    });
    // The DUST sync is behind it, and nothing has been submitted.
    expect(node('sync').state).toBe('done');
    expect(node('submit').state).toBe('pending');
  });

  it('shows the counter alone when the processor is not known', async () => {
    const node = mountTimeline(Vue.ref('provingHelper'), () => undefined);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(node('sign')).toMatchObject({ label: 'Proving on this computer', elapsed: '2 s' });
    expect(node('sign').hint).toBeUndefined();
  });

  it('never borrows the browser prover hint ("up to a minute on this device")', async () => {
    const node = mountTimeline(Vue.ref('provingHelper'), () => 'Main processor');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(node('sign').hint).toBe('Main processor');
  });

  it('a surface without a helper label still names a prover on this computer', () => {
    const { provingHelper: _unused, ...withoutHelper } = labels;
    const node = mountTimeline(Vue.ref('provingHelper'), () => undefined, withoutHelper);
    expect(node('sign').label).toBe('Proving locally');
  });
});
