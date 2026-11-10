import * as Vue from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_SLOW_AFTER_S, provingDetail, provingStepOf, useProvingElapsed, type ProvingStep } from './useProvingElapsed';

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe('which node is proving', () => {
  it('maps each proving stage to its node and prover', () => {
    expect(provingStepOf('provingDevice', false)).toEqual({ node: 'sync', prover: 'device' });
    expect(provingStepOf('provingLocal', false)).toEqual({ node: 'sync', prover: 'local' });
    expect(provingStepOf('provingZkpaas', false)).toEqual({ node: 'sync', prover: 'zkpaas' });
    expect(provingStepOf('provingCloud', false)).toEqual({ node: 'submit', prover: 'cloud' });
    expect(provingStepOf('working', true)).toEqual({ node: 'sign', prover: 'device' });
    expect(provingStepOf('working', false)).toBeNull();
    expect(provingStepOf('submitting', false)).toBeNull();
    expect(provingStepOf('idle', false)).toBeNull();
  });
});

describe('the detail line', () => {
  it('device proving: the counter and how long it can take', () => {
    expect(provingDetail({ node: 'sync', prover: 'device' }, 6, t))
      .toBe('midnight.send.provingElapsed:{"n":6} · midnight.send.provingDeviceHint');
  });

  it('a local proof server and Arkhia: the counter only', () => {
    expect(provingDetail({ node: 'sync', prover: 'local' }, 6, t)).toBe('midnight.send.provingElapsed:{"n":6}');
    expect(provingDetail({ node: 'sync', prover: 'zkpaas' }, 40, t)).toBe('midnight.send.provingElapsed:{"n":40}');
  });

  it('Gero Cloud: the counter, then the "taking longer" hint from 20 s', () => {
    const cloud: ProvingStep = { node: 'submit', prover: 'cloud' };
    expect(provingDetail(cloud, CLOUD_SLOW_AFTER_S - 1, t)).toBe('midnight.send.provingElapsed:{"n":19}');
    expect(provingDetail(cloud, CLOUD_SLOW_AFTER_S, t)).toBe('midnight.send.provingElapsed:{"n":20} · midnight.send.provingSlowHint');
  });
});

describe('useProvingElapsed', () => {
  let apps: Vue.App[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { for (const a of apps) a.unmount(); apps = []; vi.useRealTimers(); });

  function mountWith(stage: Vue.Ref<string>) {
    let result!: ReturnType<typeof useProvingElapsed>;
    const app = Vue.createApp({ setup() { result = useProvingElapsed(() => provingStepOf(stage.value, false)); return {}; }, render: () => Vue.h('div') });
    app.mount(document.createElement('div'));
    apps.push(app);
    return result;
  }

  it('runs while the step is active and stops when it ends, error included', async () => {
    const stage = Vue.ref('building');
    const e = mountWith(stage);
    expect(e.seconds.value).toBeNull();
    stage.value = 'provingCloud';
    await Vue.nextTick();
    expect(e.seconds.value).toBe(0);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(e.seconds.value).toBe(6);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(e.seconds.value).toBe(21);
    // The send failed: the stage goes back to idle and the counter stops.
    stage.value = 'idle';
    await Vue.nextTick();
    expect(e.seconds.value).toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(e.seconds.value).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restarts from zero for the next proving step', async () => {
    const stage = Vue.ref('provingDevice');
    const e = mountWith(stage);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(e.seconds.value).toBe(4);
    stage.value = 'provingCloud';
    await Vue.nextTick();
    expect(e.seconds.value).toBe(0);
  });
});
