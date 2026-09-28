// Cross-device signing bridge — per-socket registration session (pure state machine).
//
// Relay contract §5.2 (G1): the relay issues a NEW challenge on EVERY SUBSCRIBE and
// resets the session to unverified. The extension sends SUBSCRIBE more often than
// it opens the socket (credential-range expansion and force resync re-SUBSCRIBE on
// the open socket without `onSocketOpen`), and the bridge that signs the frame is
// rebuilt on every remote-signing toggle and is null while the feature is off. So
// the challenge is kept HERE, per socket and independent of the bridge, and every
// registration goes through the single `register()` entry point.
//
// The rule: while the feature is on, every new matching challenge triggers EXACTLY
// ONE registration signed with it. Deduplicated by challenge VALUE, never by a
// "pending" flag. The bridge keeps no challenge state.
//
// Fallback (§5.5, handover A4 step 6): only when NO challenge of any kind has
// arrived within `fallbackMs` of the socket opening does the bridge send the legacy
// unsigned frame, as today. That is what runs against a relay in mode `off` (today's
// production) and against an older relay. Once any challenge has been seen on the
// socket — even one for another wallet — no unsigned frame is ever sent on it.
//
// Pure apart from the injected clock and timer: no chrome, no WebSocket.

import type { DeviceChallenge } from './protocol';
import { challengeMatchesWallet, type XdevWallet } from './sessionBinding';

/** The part of the bridge this session drives. `register()` signs with `getChallenge()`. */
export interface RegisteringBridge {
  register(): void;
}

export interface RegistrationSessionDeps {
  /** The logged-in wallet the challenge must name, or null before login. */
  wallet: () => XdevWallet | null;
  /** The live bridge, or null while remote signing is off. Read at call time, never captured. */
  bridge: () => RegisteringBridge | null;
  /** Is the socket open (a send on a closed socket is silently dropped). */
  isConnected: () => boolean;
  log?: (message: string) => void;
  now?: () => number;
  /** How long after `onSocketOpen` to wait for a challenge before the legacy frame. */
  fallbackMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface RegistrationSession {
  /** A new socket: every earlier challenge is gone. Sends nothing itself; arms the fallback. */
  onSocketOpen(): void;
  /** A DEVICE_CHALLENGE frame, captured BEFORE the bridge sees the message. */
  onChallenge(challenge: DeviceChallenge): void;
  /**
   * The one entry point for every DEVICE_REGISTER. Without `force`, a challenge
   * that already has its registration sends nothing. With `force` (a new bridge
   * announcing itself, a fresh proof) the frame goes out signed with the current
   * challenge regardless.
   */
  register(opts?: { force?: boolean }): void;
  /** A `stale_challenge` ack: re-register at most once per challenge (§5.5). */
  onStaleChallenge(): void;
  /** The current challenge for the bridge's `getChallenge` option. */
  getChallenge(): DeviceChallenge | null;
  /** Logout / wallet switch: drop all per-socket state and the fallback timer. */
  reset(): void;
}

export const DEFAULT_FALLBACK_MS = 5_000;

export function createRegistrationSession(deps: RegistrationSessionDeps): RegistrationSession {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => undefined);
  const fallbackMs = deps.fallbackMs ?? DEFAULT_FALLBACK_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let challenge: DeviceChallenge | null = null; // latest challenge for THIS wallet on the current socket
  let challengeSeen = false; // any DEVICE_CHALLENGE since the socket opened (turns the fallback off)
  let signedWith: string | null = null; // challenge value of the last registration sent
  let openedAt = 0;
  let fallback: unknown = undefined;
  let foreignLogged = false; // log a foreign challenge once per socket, not once per SUBSCRIBE

  function clearFallback(): void {
    if (fallback !== undefined) {
      clearTimer(fallback);
      fallback = undefined;
    }
  }

  function register(opts: { force?: boolean } = {}): void {
    const bridge = deps.bridge();
    if (!bridge || !deps.isConnected()) return; // feature off / socket down: the challenge stays stored
    const ch = challenge;
    if (ch) {
      if (!opts.force && signedWith === ch.challenge) return; // this challenge already has its registration
      signedWith = ch.challenge;
      bridge.register(); // signs with getChallenge()
      return;
    }
    // Legacy relay or mode `off`: one unsigned frame, only if no challenge has been seen.
    if (!challengeSeen && now() - openedAt >= fallbackMs) bridge.register();
  }

  return {
    onSocketOpen(): void {
      challenge = null;
      challengeSeen = false;
      signedWith = null;
      foreignLogged = false;
      openedAt = now();
      clearFallback();
      fallback = setTimer(() => {
        fallback = undefined;
        register();
      }, fallbackMs);
    },

    onChallenge(ch: DeviceChallenge): void {
      challengeSeen = true;
      clearFallback(); // once the relay challenges, the unsigned frame is never right
      if (!challengeMatchesWallet(ch, deps.wallet())) {
        if (!foreignLogged) {
          foreignLogged = true;
          log('xdev challenge for another wallet: not registering with it');
        }
        return;
      }
      if (ch.challenge === challenge?.challenge) return; // duplicate frame
      challenge = ch;
      register(); // exactly one registration for this challenge
    },

    register,

    onStaleChallenge(): void {
      register(); // the newer challenge has normally already triggered its frame -> no-op
    },

    getChallenge: () => challenge,

    reset(): void {
      clearFallback();
      challenge = null;
      challengeSeen = false;
      signedWith = null;
      openedAt = 0;
      foreignLogged = false;
    },
  };
}
