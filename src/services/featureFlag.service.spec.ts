import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { featureFlagService } from './featureFlag.service';

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  closed = false;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (event: MessageEvent) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(cb);
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitError(): void {
    this.onerror?.();
  }
}

let onLineSpy: ReturnType<typeof vi.spyOn>;

describe('featureFlagService SSE reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })
    );
    onLineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    // Reconnect back-off adds up to 1s of jitter (Math.random() * 1000). Pin it
    // to 0 so the exponential boundaries (5s, 10s, 20s, …) are exact and the
    // fake-timer advances below are deterministic.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(async () => {
    await featureFlagService.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function initService(): Promise<void> {
    await featureFlagService.initialize('https://flags.test', 'test-user');
    expect(FakeEventSource.instances.length).toBe(1);
  }

  it('backs off exponentially on consecutive stream errors, capped at 60s', async () => {
    await initService();

    // 1st failure → retry after 5s
    FakeEventSource.instances[0].emitError();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(FakeEventSource.instances.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances.length).toBe(2);

    // 2nd consecutive failure → retry after 10s
    FakeEventSource.instances[1].emitError();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(FakeEventSource.instances.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances.length).toBe(3);

    // 3rd → 20s, 4th → 40s, 5th+ → capped at 60s
    FakeEventSource.instances[2].emitError();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeEventSource.instances.length).toBe(4);

    FakeEventSource.instances[3].emitError();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(FakeEventSource.instances.length).toBe(5);

    FakeEventSource.instances[4].emitError();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(FakeEventSource.instances.length).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances.length).toBe(6);
  });

  it('resets the back-off after a successful connection', async () => {
    await initService();

    FakeEventSource.instances[0].emitError();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeEventSource.instances.length).toBe(2);

    // Connection succeeds, then drops again → back-off restarts at 5s.
    FakeEventSource.instances[1].emitOpen();
    FakeEventSource.instances[1].emitError();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeEventSource.instances.length).toBe(3);
  });

  it('does not retry while offline; reconnects on the online event', async () => {
    await initService();

    onLineSpy.mockReturnValue(false);
    FakeEventSource.instances[0].emitError();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FakeEventSource.instances.length).toBe(1);

    onLineSpy.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    expect(FakeEventSource.instances.length).toBe(2);
  });

  it('close() cancels any pending reconnect', async () => {
    await initService();

    FakeEventSource.instances[0].emitError();
    await featureFlagService.close();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FakeEventSource.instances.length).toBe(1);
  });
});

// One slow or failed first fetch used to leave every flag at its fallback until
// the page was reloaded (issue 1195).
describe('featureFlagService after a failed first fetch', () => {
  const flags = (body: Record<string, unknown>) => ({ ok: true, json: async () => body });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    fetchMock = vi.fn().mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);
    onLineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await featureFlagService.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps retrying with back-off, then serves the flags, opens the stream and tells listeners', async () => {
    fetchMock.mockRejectedValueOnce(new Error('HTTP 502')).mockResolvedValue(flags({ isGovernanceEnabled: true }));
    const ready = vi.fn();
    const changed = vi.fn();
    featureFlagService.onReady(ready);
    featureFlagService.onFlagChange('isGovernanceEnabled', changed);

    await featureFlagService.initialize('https://flags.test', 'test-user');
    expect(featureFlagService.isReady()).toBe(false);
    expect(featureFlagService.getFlag('isGovernanceEnabled', false)).toBe(false);
    expect(FakeEventSource.instances.length).toBe(0);

    // 1st retry after 5s (fails), 2nd 10s later (succeeds).
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(featureFlagService.isReady()).toBe(false);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    expect(featureFlagService.isReady()).toBe(true);
    expect(featureFlagService.getFlag('isGovernanceEnabled', false)).toBe(true);
    expect(changed).toHaveBeenCalledWith(true, undefined);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances.length).toBe(1);

    // Ready: no further retries, only the 5-minute safety poll.
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives a retry longer than the first fetch\'s 5s before aborting it', async () => {
    let retrySignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      retrySignal = init.signal ?? undefined;
      return new Promise(() => undefined);
    });
    await featureFlagService.initialize('https://flags.test', 'test-user', 5);

    // The retry starts at 5s and may take 15s.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(retrySignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(retrySignal?.aborted).toBe(true);
  });

  it('waits for the online event instead of retrying while offline', async () => {
    onLineSpy.mockReturnValue(false);
    fetchMock.mockResolvedValue(flags({ isGovernanceEnabled: true }));
    await featureFlagService.initialize('https://flags.test', 'test-user');

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    onLineSpy.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(featureFlagService.getFlag('isGovernanceEnabled', false)).toBe(true);
  });

  it('close() cancels a pending retry', async () => {
    await featureFlagService.initialize('https://flags.test', 'test-user');
    await featureFlagService.close();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops a retry reply that arrives after close()', async () => {
    let answer: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const ready = vi.fn();
    featureFlagService.onReady(ready);
    await featureFlagService.initialize('https://flags.test', 'test-user');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await featureFlagService.close();
    answer(flags({ isGovernanceEnabled: true }));
    await vi.advanceTimersByTimeAsync(0);

    expect(featureFlagService.isReady()).toBe(false);
    expect(ready).not.toHaveBeenCalled();
    expect(FakeEventSource.instances.length).toBe(0);
  });
});
