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
// feature. See docs/plans/2026-06-29-cross-device-signing-contract.md.

import { debugLog } from '@/utils/debug';
import { generateDeviceKeypair, deviceIdFromPubKey } from './deviceIdentity';
import { createCrossDeviceSigning, type CrossDeviceSigning } from './crossDeviceSigning.service';
import { createWsTransport, feedCrossDeviceMessage } from './wsTransport';
import { isDevicesSnapshot, type DeviceRegister, type DevicePlatform, type DeviceInfo, type DeviceRegisterProof } from './protocol';
import { emptyRegistry, applyDevicesSnapshot, pubKeyOf, type DeviceRegistryState } from './deviceRegistry';

export interface CrossDeviceHandles {
  signing: CrossDeviceSigning;
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
  opts: { label: string; platform: DevicePlatform; hasSigningKey: boolean; proof?: DeviceRegisterProof },
): void {
  const register: DeviceRegister = {
    type: 'DEVICE_REGISTER',
    deviceId: identity.deviceId,
    label: opts.label,
    platform: opts.platform,
    pubKey: identity.pubKeyHex,
    hasSigningKey: opts.hasSigningKey,
    ...(opts.proof ? { proof: opts.proof } : {}),
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
  const unsubRegistry = transport.onMessage((raw) => {
    if (isDevicesSnapshot(raw)) {
      registry = applyDevicesSnapshot(registry, raw);
      debugLog('🔗 cross-device registry updated:', Object.keys(registry.byId).length, 'devices');
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
  });

  // NOTE: DEVICE_REGISTER is NOT sent here. At bootstrap time the socket is not yet
  // open (walletManager builds this before webSocketService.connect), so a send would
  // be dropped, and the relay would reject it anyway because SUBSCRIBE has not gone
  // out. It is published from the WS onopen path via register() below instead.
  const register = (): void => {
    try {
      publishDeviceRegister((msg) => transport.send(msg), { deviceId, pubKeyHex: identity.pubKeyHex }, {
        label: opts.label,
        platform: 'extension',
        hasSigningKey: opts.hasSigningKey,
        proof: opts.getProof?.(),
      });
    } catch (e) {
      debugLog('cross-device DEVICE_REGISTER failed:', e);
    }
  };

  debugLog('🔗 Cross-device signing bridge wired (dark):', deviceId);

  return {
    signing,
    selfDeviceId: deviceId,
    onCrossDeviceMessage: feedCrossDeviceMessage,
    getDevices: () => Object.values(registry.byId),
    register,
    dispose: () => {
      unsubRegistry();
      signing.dispose();
    },
  };
}
