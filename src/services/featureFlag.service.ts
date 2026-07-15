/**
 * Feature flag service.
 *
 * Talks to the self-hosted gero-sync flag service:
 *
 *   POST {baseUrl}/api/flags/evaluate   — initial snapshot
 *   GET  {baseUrl}/api/flags/stream     — SSE live updates
 *
 * Consumers should not instantiate this class directly — use the exported
 * {@link featureFlagService} singleton.
 */

type FlagChangeCallback = (newValue: unknown, oldValue: unknown) => void;

/** How often (ms) to re-poll as a safety net even when SSE looks healthy. */
const RE_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Base back-off before the first SSE reconnect after an error; doubles per failure. */
const SSE_RECONNECT_BASE_MS = 5000;

/** Ceiling for the exponential reconnect back-off. */
const SSE_RECONNECT_MAX_MS = 5 * 60 * 1000;

/**
 * Give up the live stream after this many consecutive failed reconnects and
 * fall back to the safety re-poll only. A persistently-broken stream endpoint
 * (e.g. ERR_HTTP2_PROTOCOL_ERROR from a mis-proxied SSE route) otherwise retries
 * every few seconds forever, spamming the console; flags still stay correct via
 * the RE_POLL_INTERVAL_MS safety poll. Reset to 0 whenever the stream reopens.
 */
const SSE_MAX_RECONNECT_ATTEMPTS = 6;

interface FeatureFlagConfig {
  baseUrl: string;
  contextKey: string;
}

class FeatureFlagService {
  private config: FeatureFlagConfig | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  /** Last known flag values, keyed by flag key. */
  private flagValues: Record<string, unknown> = {};

  /** Per-flag change listeners registered via {@link onFlagChange}. */
  private listeners = new Map<string, FlagChangeCallback[]>();

  private eventSource: EventSource | null = null;
  private rePollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private onlineListener: (() => void) | null = null;

  /**
   * Initialize the feature flag service.
   *
   * @param baseUrl - Root URL of the gero-sync flag service
   *   (e.g. "https://sync.gerowallet.io" or "http://localhost:8082").
   * @param contextKey - Stable identifier for this client instance; used as
   *   the {@code userId} in the evaluation context so targeting rules can
   *   scope per-user. Defaults to "anonymous-user".
   * @param timeout - Optional initialization timeout in seconds. Defaults to 5.
   */
  async initialize(baseUrl: string, contextKey?: string, timeout?: number): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    const resolvedBaseUrl = this.normalizeBaseUrl(baseUrl);
    if (!resolvedBaseUrl) {
      console.warn('🚩 FeatureFlag initialize(): invalid base URL, skipping:', baseUrl);
      return;
    }

    const resolvedContextKey = contextKey || 'anonymous-user';

    // Already initialized against the same base URL? Nothing to do.
    if (this.isInitialized && this.config?.baseUrl === resolvedBaseUrl) {
      return;
    }

    this.initializationPromise = (async () => {
      try {
        this.config = { baseUrl: resolvedBaseUrl, contextKey: resolvedContextKey };

        await this.fetchSnapshot(timeout ?? 5);
        this.isInitialized = true;
        this.openStream();
        this.startSafetyPoll();
      } catch (error) {
        console.warn('🚩 FeatureFlag initialization failed, will use fallback values:', error);
        this.isInitialized = false;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Get a feature flag value synchronously. Returns {@code fallbackValue} if
   * the service is not initialized or the flag is unknown.
   */
  getFlag<T>(flagKey: string, fallbackValue: T): T {
    if (!this.isInitialized) {
      return fallbackValue;
    }
    const value = this.flagValues[flagKey];
    if (value === undefined) {
      return fallbackValue;
    }
    return value as T;
  }

  /** Snapshot of all currently-known flag values. */
  getAllFlags(): Record<string, unknown> {
    if (!this.isInitialized) {
      return {};
    }
    return { ...this.flagValues };
  }

  /**
   * Subscribe to changes for a specific flag. Returns an unsubscribe function.
   * The callback fires whenever the server pushes a new value for {@code flagKey}
   * that differs from the last known value.
   */
  onFlagChange(flagKey: string, callback: FlagChangeCallback): () => void {
    if (!this.listeners.has(flagKey)) {
      this.listeners.set(flagKey, []);
    }
    this.listeners.get(flagKey)!.push(callback);

    return () => {
      const callbacks = this.listeners.get(flagKey);
      if (!callbacks) return;
      const idx = callbacks.indexOf(callback);
      if (idx > -1) callbacks.splice(idx, 1);
      if (callbacks.length === 0) this.listeners.delete(flagKey);
    };
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  /** Close any open streams and clear all listeners. */
  async close(): Promise<void> {
    this.closeStream();
    this.cancelReconnect();
    this.stopSafetyPoll();
    this.reconnectAttempts = 0;
    this.flagValues = {};
    this.listeners.clear();
    this.isInitialized = false;
    this.config = null;
  }

  // ── Internals ──────────────────────────────────────────────────────

  private normalizeBaseUrl(input: string): string | null {
    if (!input) return null;
    const trimmed = input.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(trimmed)) return null;
    return trimmed;
  }

  private buildContextBody(): Record<string, unknown> {
    const cfg = this.config!;
    return {
      userId: cfg.contextKey,
    };
  }

  private async fetchSnapshot(timeoutSeconds: number): Promise<void> {
    const cfg = this.config!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutSeconds) * 1000);

    try {
      const res = await fetch(`${cfg.baseUrl}/api/flags/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildContextBody()),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const snapshot = (await res.json()) as Record<string, unknown>;
      this.applySnapshot(snapshot);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Replace the current flag map with {@code next}, firing change callbacks
   * for every key whose value differs from before.
   */
  private applySnapshot(next: Record<string, unknown>): void {
    const previous = this.flagValues;
    const changedKeys = new Set<string>();

    for (const key of Object.keys(next)) {
      if (previous[key] !== next[key]) {
        changedKeys.add(key);
      }
    }
    for (const key of Object.keys(previous)) {
      if (!(key in next) && previous[key] !== undefined) {
        changedKeys.add(key);
      }
    }

    this.flagValues = next;

    for (const key of changedKeys) {
      const callbacks = this.listeners.get(key);
      if (!callbacks) continue;
      const newValue = next[key];
      const oldValue = previous[key];
      for (const cb of callbacks) {
        try {
          cb(newValue, oldValue);
        } catch (e) {
          console.error(`🚩 flag change listener for "${key}" threw:`, e);
        }
      }
    }
  }

  private openStream(): void {
    if (!this.config) return;
    this.closeStream();
    this.cancelReconnect();

    const params = new URLSearchParams();
    const cfg = this.config;
    if (cfg.contextKey) params.set('userId', cfg.contextKey);
    const url = `${cfg.baseUrl}/api/flags/stream${params.toString() ? `?${params.toString()}` : ''}`;

    try {
      this.eventSource = new EventSource(url);
    } catch (e) {
      console.warn('🚩 Failed to open flag stream, will retry:', e);
      this.scheduleReconnect();
      return;
    }

    // A successful (re)connection clears the back-off so the next outage starts
    // from the base delay again.
    this.eventSource.onopen = () => {
      if (this.reconnectAttempts > 0) console.info('🚩 flag stream reconnected');
      this.reconnectAttempts = 0;
    };

    this.eventSource.addEventListener('flags', (event: MessageEvent) => {
      try {
        const snapshot = JSON.parse(event.data) as Record<string, unknown>;
        this.applySnapshot(snapshot);
      } catch (e) {
        console.warn('🚩 Failed to parse flag stream message:', e);
      }
    });

    this.eventSource.onerror = () => {
      this.closeStream();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.isInitialized) return;
    if (this.reconnectTimer !== null) return; // one pending reconnect at a time

    // Offline: a blind timer would fail (and spam the console) every cycle —
    // wait for the 'online' event instead.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.reconnectWhenOnline();
      return;
    }

    // Persistent failure: stop retrying and lean on the safety re-poll. Log the
    // give-up exactly once (the extra increment past the cap gates the message).
    if (this.reconnectAttempts >= SSE_MAX_RECONNECT_ATTEMPTS) {
      if (this.reconnectAttempts === SSE_MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        console.warn(
          `🚩 flag stream failed ${SSE_MAX_RECONNECT_ATTEMPTS}× — giving up on live updates; ` +
          `flags will still refresh via the ${RE_POLL_INTERVAL_MS / 60000}-min safety poll.`,
        );
      }
      return;
    }

    // Exponential back-off with jitter, capped: 5s, 10s, 20s, 40s … up to the ceiling.
    const backoff = Math.min(SSE_RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, SSE_RECONNECT_MAX_MS);
    const delay = backoff + Math.floor(Math.random() * 1000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isInitialized) this.openStream();
    }, delay);
  }

  private reconnectWhenOnline(): void {
    if (this.onlineListener) return;
    this.onlineListener = () => {
      this.removeOnlineListener();
      if (this.isInitialized) this.openStream();
    };
    globalThis.addEventListener('online', this.onlineListener);
  }

  private removeOnlineListener(): void {
    if (!this.onlineListener) return;
    globalThis.removeEventListener('online', this.onlineListener);
    this.onlineListener = null;
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.removeOnlineListener();
  }

  private closeStream(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
    }
  }

  private startSafetyPoll(): void {
    this.stopSafetyPoll();
    this.rePollTimer = setInterval(() => {
      this.fetchSnapshot(5).catch((e) => {
        console.warn('🚩 flag safety re-poll failed:', e);
      });
    }, RE_POLL_INTERVAL_MS);
  }

  private stopSafetyPoll(): void {
    if (this.rePollTimer !== null) {
      clearInterval(this.rePollTimer);
      this.rePollTimer = null;
    }
  }
}

export const featureFlagService = new FeatureFlagService();
export default featureFlagService;
