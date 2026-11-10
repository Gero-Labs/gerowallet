import * as Vue from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/midnightStore', async () => {
  const { reactive } = await import('vue');
  return { midnightStore: reactive({ sendProgress: null as null | { phase: string; percent?: number } }) };
});

import { midnightStore } from '@/stores/midnightStore';
import { useMidnightSendTimeline, type SendTimelineLabels, type TimelineNode } from './useMidnightSendTimeline';
import { provingDetail } from './useProvingElapsed';

const labels: SendTimelineLabels = {
  authorize: 'Authorize', build: 'Build', sync: 'Sync', sign: 'Sign', submit: 'Submit',
  provingDevice: 'Proving on this device', provingLocal: 'Proving locally', provingZkpaas: 'Proving via Arkhia',
  provingCloud: 'Proving with Gero Cloud',
};
const t = (key: string, params?: Record<string, unknown>) => ({
  'midnight.send.provingElapsed': `${params?.['n']}\u00a0s`,
  'midnight.send.provingDeviceHint': 'This can take up to a minute on this device.',
  'midnight.send.provingSlowHint': 'Taking longer than usual. Keep this window open.',
} as Record<string, string>)[key] ?? key;

const s = (n: number) => `${n}\u00a0s`;
let apps: Vue.App[] = [];
function mountTimeline(stage: Vue.Ref<string>, announce?: (text: string) => void, busy?: Vue.Ref<string | undefined>) {
  let nodes!: Vue.ComputedRef<TimelineNode[]>;
  const app = Vue.createApp({
    setup() {
      nodes = useMidnightSendTimeline(Vue.computed(() => stage.value as never), Vue.computed(() => labels), {
        provingDetailFor: (step, seconds) => provingDetail(step, seconds, t),
        announce,
        submitDetail: busy ? Vue.computed(() => busy.value) : undefined,
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

describe('send timeline proving feedback', () => {
  it('Gero Cloud: the submit node says so, with an indeterminate bar and a running counter', async () => {
    const stage = Vue.ref('working');
    const node = mountTimeline(stage);
    stage.value = 'provingCloud';
    await Vue.nextTick();
    expect(node('submit')).toMatchObject({ label: 'Proving with Gero Cloud', state: 'active', showBar: true, percent: null, elapsed: s(0) });
    expect(node('submit').hint).toBeUndefined();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(node('submit').elapsed).toBe(s(6));
  });

  it('Gero Cloud: the "taking longer" hint appears at 20 s and stays until the step ends', async () => {
    const stage = Vue.ref('provingCloud');
    const node = mountTimeline(stage);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(node('submit').elapsed).toBe(s(19));
    expect(node('submit').hint).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(node('submit')).toMatchObject({ elapsed: s(20), hint: 'Taking longer than usual. Keep this window open.' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(node('submit')).toMatchObject({ elapsed: s(50), hint: 'Taking longer than usual. Keep this window open.' });
    stage.value = 'done';
    await Vue.nextTick();
    expect(node('submit')).toMatchObject({ state: 'done', label: 'Submit' });
    expect(node('submit').elapsed).toBeUndefined();
    expect(node('submit').hint).toBeUndefined();
  });

  it('a plain submit (already proven) is "Submit" with no counter', async () => {
    const node = mountTimeline(Vue.ref('submitting'));
    expect(node('submit')).toMatchObject({ label: 'Submit', state: 'active' });
    expect(node('submit').elapsed).toBeUndefined();
    expect(node('submit').showBar).toBeUndefined();
  });

  it.each([
    ['provingDevice', 'This can take up to a minute on this device.'],
    ['provingLocal', undefined],
    ['provingZkpaas', undefined],
  ])('%s: the proving node shows a running counter', async (proving, hint) => {
    const node = mountTimeline(Vue.ref(proving));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(node('sync')).toMatchObject({ state: 'active', percent: null, elapsed: s(3) });
    expect(node('sync').hint).toBe(hint);
  });

  it('the DUST fee proof on this device counts on the sign node', async () => {
    (midnightStore as { sendProgress: unknown }).sendProgress = { phase: 'proving' };
    const node = mountTimeline(Vue.ref('working'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(node('sign')).toMatchObject({ elapsed: s(2), hint: 'This can take up to a minute on this device.' });
  });

  it('the counter stops when a send fails', async () => {
    const stage = Vue.ref('provingCloud');
    const node = mountTimeline(stage);
    await vi.advanceTimersByTimeAsync(5_000);
    stage.value = 'idle';
    await Vue.nextTick();
    expect(node('submit').elapsed).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('what the live region hears', () => {
  it('the proving label once, the 20 s hint once, never the counter', async () => {
    const said: string[] = [];
    const stage = Vue.ref('submitting');
    mountTimeline(stage, (text) => said.push(text));
    stage.value = 'provingCloud';
    await Vue.nextTick();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(said).toEqual(['Proving with Gero Cloud', 'Taking longer than usual. Keep this window open.']);
  });

  it('a hint that shows from the start goes with the label', async () => {
    const said: string[] = [];
    mountTimeline(Vue.ref('provingDevice'), (text) => said.push(text));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(said).toEqual(['Proving on this device. This can take up to a minute on this device.']);
  });

  it('a new proving step is said again', async () => {
    const said: string[] = [];
    const stage = Vue.ref('provingLocal');
    mountTimeline(stage, (text) => said.push(text));
    stage.value = 'submitting';
    await Vue.nextTick();
    stage.value = 'provingCloud';
    await Vue.nextTick();
    expect(said).toEqual(['Proving locally', 'Proving with Gero Cloud']);
  });
});

describe('waiting for a busy Gero Cloud', () => {
  it('keeps the Gero Cloud label, shows the countdown without the counter or a bar, then proves again from zero', async () => {
    const said: string[] = [];
    const stage = Vue.ref('provingCloud');
    const busy = Vue.ref<string | undefined>(undefined);
    const node = mountTimeline(stage, (text) => said.push(text), busy);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(node('submit').elapsed).toBe(s(8));

    stage.value = 'waiting';
    busy.value = 'Gero Cloud is busy. Trying again in 10\u00a0s…';
    await Vue.nextTick();
    expect(node('submit')).toMatchObject({ label: 'Proving with Gero Cloud', state: 'waiting', detail: busy.value });
    expect(node('submit').elapsed).toBeUndefined();
    expect(node('submit').showBar).toBeUndefined();
    busy.value = 'Gero Cloud is busy. Trying again in 9\u00a0s…';
    await Vue.nextTick();

    stage.value = 'provingCloud';
    busy.value = undefined;
    await Vue.nextTick();
    expect(node('submit')).toMatchObject({ state: 'active', elapsed: s(0) });
    // Once when the wait starts (not each second), once for the resubmit.
    expect(said).toEqual(['Proving with Gero Cloud', 'Gero Cloud is busy. Trying again in 10\u00a0s…', 'Proving with Gero Cloud']);
  });

  it('a wait on a proven submit keeps "Submit"', async () => {
    const stage = Vue.ref('submitting');
    const node = mountTimeline(stage);
    stage.value = 'waiting';
    await Vue.nextTick();
    expect(node('submit')).toMatchObject({ label: 'Submit', state: 'waiting' });
  });
});
