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

describe('featureFlagService SSE reconnect', () => {
  let onLineSpy: ReturnType<typeof vi.spyOn>;

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
