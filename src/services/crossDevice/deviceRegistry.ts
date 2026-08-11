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

/**
 * Outcome of the XDP capability round-trip check. See {@link checkProverEcho}.
 */
export type ProverEchoResult =
  | 'not_advertised' // this device is not offering to prove; nothing to check
  | 'self_absent' // our own device is not in the snapshot yet (early/partial fan-out)
  | 'confirmed' // the relay preserved hasProver + proverLedgerVersion
  | 'stripped'; // the relay dropped or altered them — Q1b is answered, badly

/**
 * Answers gero-sync **Q1b empirically, from a running client**: does the relay
 * preserve unknown `DeviceInfo` fields in its `DEVICES` fan-out, or rebuild the
 * object against a fixed server-side schema?
 *
 * The relay echoes THIS device back in every snapshot (that is what the `(self)`
 * marker in the bootstrap log tracks), so the snapshot is a free round-trip test:
 * advertise `hasProver`, then look at what came back for our own deviceId. If the
 * flag survived, the relay is field-preserving and XDP discovery works. If it did
 * not, capability advertising is a silent no-op on BOTH clients — the phone will
 * never see a prover no matter what either side sends.
 *
 * This exists because "silent" is the actual danger in Q1b. A stripped field
 * produces no error anywhere: the desktop serves correctly, the phone simply
 * never asks. Without this check the symptom is "XDP mysteriously never engages",
 * which is an expensive thing to debug across two codebases and a relay.
 *
 * Pure: the caller decides what to do with the verdict (log, surface, disable).
 */
export function checkProverEcho(
  state: DeviceRegistryState,
  selfDeviceId: string,
  advertised: { hasProver: boolean; proverLedgerVersion: string } | undefined,
): ProverEchoResult {
  if (!advertised?.hasProver) return 'not_advertised';
  const self = state.byId[selfDeviceId];
  if (!self) return 'self_absent';
  const survived = self.hasProver === true
    && self.proverLedgerVersion === advertised.proverLedgerVersion;
  return survived ? 'confirmed' : 'stripped';
}
