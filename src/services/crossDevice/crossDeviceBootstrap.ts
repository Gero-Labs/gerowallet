// Cross-device signing bridge — gated bootstrap (glue).
//
// Encapsulates the flag-gated wiring so walletManager only calls one function.
// When isCrossDeviceSigningEnabled is OFF this returns null and does nothing:
// no service is created, no DEVICE_REGISTER is sent, no listener is registered.
// When ON, it builds the service over the WS transport, publishes a
// DEVICE_REGISTER for this device, and returns handles for teardown.
//
// This is Phase 0 dark wiring. The device identity is generated fresh here
// (section 8 Q2: keygen is the Phase-0 source of pubKey). The registry lookup
// (resolvePubKey) is the gero-sync ask; until the server-backed registry ships
// it returns null, so inbound messages fail verification and are dropped — the
// safe default for a dark feature. See
// docs/plans/2026-06-29-cross-device-signing-bridge.md sections 7-8.

import featureFlagsStore from '@/stores/featureFlagsStore';
import { debugLog } from '@/utils/debug';
import { generateDeviceKeypair, deviceIdFromPubKey } from './deviceIdentity';
import { createCrossDeviceSigning, type CrossDeviceSigning } from './crossDeviceSigning.service';
import { createWsTransport, feedCrossDeviceMessage } from './wsTransport';
import { signMessage } from './envelope';
import { CROSS_DEVICE_PROTOCOL_VERSION, type DeviceRegister, type DevicePlatform } from './protocol';

export interface CrossDeviceHandles {
  signing: CrossDeviceSigning;
  /** Feed an inbound raw relay message (wired into WsHandlers.onCrossDeviceMessage). */
  onCrossDeviceMessage: (raw: unknown) => void;
  dispose(): void;
}

/**
 * Build a DEVICE_REGISTER for this device and send it over the transport.
 */
async function publishDeviceRegister(
  send: (msg: DeviceRegister) => void,
  identity: { deviceId: string; privKeyHex: string; pubKeyHex: string },
  opts: { label: string; platform: DevicePlatform; hasSigningKey: boolean; now: number },
): Promise<void> {
  const register = await signMessage<DeviceRegister>(
    {
      v: CROSS_DEVICE_PROTOCOL_VERSION,
      type: 'DEVICE_REGISTER',
      deviceId: identity.deviceId,
      label: opts.label,
      platform: opts.platform,
      pubKey: identity.pubKeyHex,
      hasSigningKey: opts.hasSigningKey,
      createdAt: opts.now,
    },
    identity.privKeyHex,
  );
  send(register);
}

/**
 * Gated bootstrap for the cross-device signing bridge. Returns null (and does
 * nothing) when the feature flag is off.
 */
export function bootstrapCrossDeviceSigning(opts: {
  label: string;
  hasSigningKey: boolean;
}): CrossDeviceHandles | null {
  if (!featureFlagsStore.isCrossDeviceSigningEnabled()) {
    return null;
  }

  const keypair = generateDeviceKeypair();
  const deviceId = deviceIdFromPubKey(keypair.pubKeyHex);
  const identity = { deviceId, privKeyHex: keypair.privKeyHex, pubKeyHex: keypair.pubKeyHex };
  const transport = createWsTransport();

  const signing = createCrossDeviceSigning({
    transport,
    identity: { deviceId, privKeyHex: keypair.privKeyHex },
    // Registry is the gero-sync ask (section 8). Until it ships, no sibling
    // pubkeys resolve, so inbound messages are dropped — safe for a dark launch.
    resolvePubKey: async () => null,
    now: () => Date.now(),
    newId: () => globalThis.crypto.randomUUID(),
  });

  void publishDeviceRegister((msg) => transport.send(msg), identity, {
    label: opts.label,
    platform: 'extension',
    hasSigningKey: opts.hasSigningKey,
    now: Date.now(),
  }).catch((e) => debugLog('cross-device DEVICE_REGISTER failed:', e));

  debugLog('🔗 Cross-device signing bridge wired (dark):', deviceId);

  return {
    signing,
    onCrossDeviceMessage: feedCrossDeviceMessage,
    dispose: () => signing.dispose(),
  };
}
