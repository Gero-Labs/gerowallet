// Cross-device signing bridge — device registry (pure).
//
// Holds the server-pushed snapshot of sibling devices (DEVICES frame) so the
// service can resolve a sender's public key to verify their signed messages.
// This is what replaces the Phase-0 `resolvePubKey: async () => null` stub: once
// gero-sync fans out a DEVICES snapshot, verification can succeed.
//
// Pure reducer: no chrome, no WebSocket, no Date.now. The snapshot REPLACES the
// registry (the server always sends the full current list).

import type { DeviceInfo, DevicesSnapshot } from './protocol';

export interface DeviceRegistryState {
  byId: Record<string, DeviceInfo>;
}

export function emptyRegistry(): DeviceRegistryState {
  return { byId: {} };
}

/** Replace the registry with the server's full snapshot. */
export function applyDevicesSnapshot(
  _state: DeviceRegistryState,
  snapshot: DevicesSnapshot,
): DeviceRegistryState {
  const byId: Record<string, DeviceInfo> = {};
  for (const d of snapshot.devices) {
    byId[d.deviceId] = d;
  }
  return { byId };
}

/** Resolve a device's registered public key, or null if unknown/unverifiable. */
export function pubKeyOf(state: DeviceRegistryState, deviceId: string): string | null {
  return state.byId[deviceId]?.pubKey ?? null;
}
