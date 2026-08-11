// Cross-device signing bridge — gated bootstrap (glue).
//
// Encapsulates the flag-gated wiring so walletManager only calls one function.
// When isCrossDeviceSigningEnabled is OFF this returns null and does nothing:
// no service is created, no DEVICE_REGISTER is sent, no listener is registered.
// When ON, it builds the service over the WS transport, publishes a
// DEVICE_REGISTER for this device, subscribes to the server DEVICES snapshot to
// back sender verification, and returns handles for teardown.
//
// This is dark wiring. The device identity is generated fresh here (a persisted
// per-device key store is a follow-up). resolvePubKey resolves against the
// server-pushed DEVICES registry: until gero-sync fans one out, no sibling
// pubkeys resolve, so inbound messages are dropped, the safe default for a dark
// feature. See the internal cross-device signing relay contract.

import { debugLog } from '@/utils/debug';
import { generateDeviceKeypair, deviceIdFromPubKey } from './deviceIdentity';
import { createCrossDeviceSigning, type CrossDeviceSigning } from './crossDeviceSigning.service';
import { createProveService, type ProveService } from './proveService';
import type { PairConfirm } from './protocol';
import { createWsTransport, createProveWsTransport, feedCrossDeviceMessage } from './wsTransport';
import { isDevicesSnapshot, type DeviceRegister, type DevicePlatform, type DeviceInfo, type DeviceRegisterProof } from './protocol';
import { emptyRegistry, applyDevicesSnapshot, pubKeyOf, checkProverEcho, type DeviceRegistryState } from './deviceRegistry';

/**
 * XDP serving wiring (R3/R6). Absent => this desktop never serves proofs: no
 * prove service is created and PROVE_* frames are parsed and dropped. Present
 * => the service is created, but every gate still applies per job.
 */
export interface ProveServingOptions {
  /** Proof-server docker tag we prove against (advertised in DEVICE_REGISTER). */
  ledgerVersion: string;
  /** Live per-device gate: `isServingProofsTo(settings, deviceId)`. */
  isServingEnabled: (deviceId: string) => boolean;
  /** Local proof-server `/health`. */
  checkProverHealth: () => Promise<boolean>;
  /** Signed-but-unproven bytes in, finalized bytes out (midnightUnshieldedProver). */
  prove: (payload: Uint8Array) => Promise<Uint8Array>;
}

export interface CrossDeviceHandles {
  signing: CrossDeviceSigning;
  /** XDP prover service, or null when serving is not wired for this session. */
  proving: ProveService | null;
  /** This device's own id (to mark "this device" and skip it in the pairing list). */
  selfDeviceId: string;
  /** Feed an inbound raw relay message (wired into WsHandlers.onCrossDeviceMessage). */
  onCrossDeviceMessage: (raw: unknown) => void;
  /** Current sibling devices from the server-pushed DEVICES snapshot (for the settings UI). */
  getDevices(): DeviceInfo[];
  /**
   * Publish this device's DEVICE_REGISTER over the transport. MUST be called only
   * once the socket is OPEN and has already SUBSCRIBE'd on the same ordered stream:
   * the relay rejects a DEVICE_REGISTER from a session that has not SUBSCRIBE'd, and
   * an unopened socket silently drops the send. Wire this to the WS onopen path so it
   * fires on the initial connect and on every reconnect (the relay upserts by
   * deviceId, so repeat registers are idempotent).
   */
  register(): void;
  dispose(): void;
}

/**
 * Build a DEVICE_REGISTER for this device and send it over the transport.
 * Unsigned (trust-on-first-use for the registry): the pubKey it announces is what
 * subsequently verifies this device's SIGN_REQUEST/SIGN_RESPONSE messages. The
 * wallet is inferred server-side from the socket's SUBSCRIBE.
 */
function publishDeviceRegister(
  send: (msg: DeviceRegister) => void,
  identity: { deviceId: string; pubKeyHex: string },
  opts: {
    label: string;
    platform: DevicePlatform;
    hasSigningKey: boolean;
    proof?: DeviceRegisterProof;
    prover?: { hasProver: boolean; proverLedgerVersion: string };
  },
): void {
  const register: DeviceRegister = {
    type: 'DEVICE_REGISTER',
    deviceId: identity.deviceId,
    label: opts.label,
    platform: opts.platform,
    pubKey: identity.pubKeyHex,
    hasSigningKey: opts.hasSigningKey,
    ...(opts.proof ? { proof: opts.proof } : {}),
    // XDP R2. Only announced when actually serving: advertising a prover we
    // would then reject on every gate is worse than staying silent, because the
    // phone would build + encrypt a payload before learning it cannot be served.
    ...(opts.prover?.hasProver
      ? { hasProver: true, proverLedgerVersion: opts.prover.proverLedgerVersion }
      : {}),
  };
  send(register);
}

/**
 * Gated bootstrap for the cross-device signing bridge. Returns null (and does
 * nothing) when the feature is off.
 *
 * The flag decision is passed in by the caller rather than read here, because
 * this runs in the background service worker where the EventSource-based flag
 * service cannot run and featureFlagsStore is never initialized. walletManager
 * reads the flag from chrome.storage.local (mirrored there by the UI) and passes
 * it as `enabled`.
 */
export function bootstrapCrossDeviceSigning(opts: {
  label: string;
  hasSigningKey: boolean;
  enabled: boolean;
  // Stable, persisted relay-auth identity (so pins survive logins). Falls back to
  // a fresh ephemeral keypair when omitted (tests / no storage).
  identity?: { deviceId: string; privKeyHex: string; pubKeyHex: string };
  // Per-wallet trust gates (see crossDeviceSigning.service). Read live by the
  // caller's closures so trust/untrust take effect without a re-bootstrap.
  isRequesterTrusted?: (deviceId: string, pubKey: string) => boolean;
  isResponderTrusted?: (deviceId: string, pubKey: string) => boolean;
  // Latest cached wallet-control proof, read at each register() so a proof
  // produced AFTER bootstrap (on enable) rides the next DEVICE_REGISTER.
  getProof?: () => DeviceRegisterProof | undefined;
  // XDP R2: live prover capability, read at each register() for the same reason
  // as getProof — the user can flip the serving toggle after bootstrap, and the
  // next register (every reconnect) should carry the truth.
  getProver?: () => { hasProver: boolean; proverLedgerVersion: string } | undefined;
  // QR pairing: a verified inbound PAIR_CONFIRM (already frame-sig-checked by the
  // service). The caller (walletManager) does the nonce consume + proof verify + pin.
  onPairConfirm?: (frame: PairConfirm) => void;
  // XDP serving (R3/R6). Omit to never serve proofs.
  serving?: ProveServingOptions;
}): CrossDeviceHandles | null {
  if (!opts.enabled) {
    return null;
  }

  const identity = opts.identity ?? (() => {
    const kp = generateDeviceKeypair();
    return { deviceId: deviceIdFromPubKey(kp.pubKeyHex), privKeyHex: kp.privKeyHex, pubKeyHex: kp.pubKeyHex };
  })();
  const deviceId = identity.deviceId;
  const transport = createWsTransport();

  // Server-pushed device registry backs sender-pubkey resolution.
  let registry: DeviceRegistryState = emptyRegistry();
  // What our last DEVICE_REGISTER actually advertised, for the Q1b round-trip
  // check below. Recorded at send time rather than read from getProver() so the
  // check compares against what the relay was really given.
  let advertisedProver: { hasProver: boolean; proverLedgerVersion: string } | undefined;
  // Latch so a stripped-field relay logs once per session, not once per snapshot
  // (DEVICES arrives on every reconnect and every sibling change).
  let proverEchoReported = false;
  const unsubRegistry = transport.onMessage((raw) => {
    if (isDevicesSnapshot(raw)) {
      registry = applyDevicesSnapshot(registry, raw);
      // gero-sync Q1b, answered from production instead of by waiting: if the
      // relay rebuilds DeviceInfo against a fixed schema, our own advertised
      // hasProver never comes back, XDP discovery silently no-ops on BOTH
      // clients, and the only symptom is "the phone never asks to prove".
      const echo = checkProverEcho(registry, deviceId, advertisedProver);
      if (echo === 'stripped' && !proverEchoReported) {
        proverEchoReported = true;
        debugLog('⚠️ XDP Q1b: relay STRIPPED hasProver/proverLedgerVersion from the DEVICES '
          + 'echo of this device — capability advertising is a no-op; the phone will never see '
          + 'a prover. Relay must preserve unknown DeviceInfo fields.');
      } else if (echo === 'confirmed' && !proverEchoReported) {
        proverEchoReported = true;
        debugLog('✅ XDP Q1b: relay preserved hasProver/proverLedgerVersion in the DEVICES echo.');
      }
      // Diagnostic: show WHO is in the snapshot so an empty "other devices" list
      // can be told apart from a UI-filtering bug. platform:id8(self?) per device.
      const ids = Object.values(registry.byId).map((d) =>
        `${d.platform}:${(d.deviceId || '').slice(0, 8)}${d.deviceId === deviceId ? '(self)' : ''}${d.hasSigningKey ? '+sig' : ''}`);
      debugLog('🔗 cross-device registry updated:', Object.keys(registry.byId).length, '→', ids.join(', ') || '(none)');
    } else if ((raw as { type?: string })?.type === 'DEVICES') {
      // Arrived but failed the shape guard — would otherwise be silently ignored.
      debugLog('⚠️ DEVICES snapshot failed shape guard:', JSON.stringify(raw).slice(0, 400));
    }
  });

  const signing = createCrossDeviceSigning({
    transport,
    identity: { deviceId, privKeyHex: identity.privKeyHex },
    resolvePubKey: async (id) => pubKeyOf(registry, id),
    now: () => Date.now(),
    newId: () => globalThis.crypto.randomUUID(),
    isRequesterTrusted: opts.isRequesterTrusted,
    isResponderTrusted: opts.isResponderTrusted,
    onPairConfirm: opts.onPairConfirm,
    log: (m) => debugLog('🔗 xdev-wake:', m),
  });

  // NOTE: DEVICE_REGISTER is NOT sent here. At bootstrap time the socket is not yet
  // open (walletManager builds this before webSocketService.connect), so a send would
  // be dropped, and the relay would reject it anyway because SUBSCRIBE has not gone
  // out. It is published from the WS onopen path via register() below instead.
  const register = (): void => {
    try {
      const proof = opts.getProof?.();
      const prover = opts.getProver?.();
      // Record for the Q1b echo check, and re-arm it: a toggle change means the
      // next snapshot is a fresh round-trip worth reporting on.
      if (prover?.hasProver !== advertisedProver?.hasProver
        || prover?.proverLedgerVersion !== advertisedProver?.proverLedgerVersion) {
        proverEchoReported = false;
      }
      advertisedProver = prover;
      publishDeviceRegister((msg) => transport.send(msg), { deviceId, pubKeyHex: identity.pubKeyHex }, {
        label: opts.label,
        platform: 'extension',
        hasSigningKey: opts.hasSigningKey,
        proof,
        prover,
      });
      debugLog('📇 DEVICE_REGISTER sent:', deviceId, 'proof=' + (proof ? 'yes' : 'no'),
        'prover=' + (prover?.hasProver ? prover.proverLedgerVersion : 'no'));
    } catch (e) {
      debugLog('cross-device DEVICE_REGISTER failed:', e);
    }
  };

  // XDP prover service. Shares the transport, identity and registry with the
  // signing bridge — XDP adds no new pairing, so the pinned peer that may ask us
  // to sign is exactly the peer that may ask us to prove.
  const proving = opts.serving
    ? createProveService({
      transport: createProveWsTransport(),
      identity: { deviceId, privKeyHex: identity.privKeyHex },
      resolvePubKey: async (id) => pubKeyOf(registry, id),
      // Reuses the SAME pin check as signing (gate 1); the serving toggle is a
      // separate, narrower gate on top of it (gate 2).
      isPeerPinned: (id, pk) => opts.isRequesterTrusted?.(id, pk) ?? false,
      isServingEnabled: opts.serving.isServingEnabled,
      ledgerVersion: opts.serving.ledgerVersion,
      checkProverHealth: opts.serving.checkProverHealth,
      prove: opts.serving.prove,
      now: () => Date.now(),
      newId: () => globalThis.crypto.randomUUID(),
      log: (m) => debugLog('🧾 xprove:', m),
    })
    : null;

  debugLog('🔗 Cross-device signing bridge wired (dark):', deviceId,
    proving ? '(+ XDP prover)' : '');

  return {
    signing,
    proving,
    selfDeviceId: deviceId,
    onCrossDeviceMessage: feedCrossDeviceMessage,
    getDevices: () => Object.values(registry.byId),
    register,
    dispose: () => {
      unsubRegistry();
      signing.dispose();
      proving?.dispose();
    },
  };
}
