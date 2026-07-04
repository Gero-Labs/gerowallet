import Vue from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import {
  defaultRemoteSigningSettings,
  hasPairedSigner,
  type RemoteSigningSettings,
  type SigningPolicy,
} from '@/services/crossDevice/crossDeviceTrust';
import type { DeviceInfo } from '@/services/crossDevice/protocol';
import type { PairingQrPayload } from '@/services/crossDevice/pairingQr';

/** A device paired via QR scan (background-consumed on read). */
export interface PairedResult { deviceId: string; label: string; at: number }

/**
 * UI-side mirror of the per-wallet remote-signing settings that live in the
 * background (wallet-db). Read by the Security settings dialog and by the Send
 * flow's "sign on another device" gate. All mutations round-trip through the
 * background and return the fresh settings, which we store back here.
 */
export interface CrossDeviceListEntry {
  device: DeviceInfo;
  trusted: boolean;
  isSelf: boolean;
}

interface RemoteSigningState {
  settings: RemoteSigningSettings;
  devices: CrossDeviceListEntry[];
  loaded: boolean;
  loading: boolean;
}

const state = Vue.observable<RemoteSigningState>({
  settings: defaultRemoteSigningSettings(),
  devices: [],
  loaded: false,
  loading: false,
});

interface SettingsReply { success: boolean; settings?: RemoteSigningSettings; error?: string }
interface DevicesReply { success: boolean; devices?: CrossDeviceListEntry[]; error?: string }
interface PairingQrReply { success: boolean; payload?: PairingQrPayload; error?: string }
interface PairingStatusReply { success: boolean; paired?: PairedResult | null }

async function send<T>(method: MessageTypes, data?: Record<string, unknown>): Promise<T> {
  const res = (await Messaging.sendToBackgroundFromOptions({ method, data })) as { data: T };
  return res.data;
}

export const remoteSigningStore = {
  state,

  /** Load settings + the live device list from the background. */
  async refresh(): Promise<void> {
    state.loading = true;
    try {
      const [s, d] = await Promise.all([
        send<SettingsReply>(MessageTypes.GET_CROSS_DEVICE_SETTINGS),
        send<DevicesReply>(MessageTypes.GET_CROSS_DEVICE_DEVICES),
      ]);
      if (s.success && s.settings) state.settings = s.settings;
      state.devices = d.success && d.devices ? d.devices : [];
      state.loaded = true;
    } catch (e) {
      console.error('remoteSigningStore.refresh failed:', e);
    } finally {
      state.loading = false;
    }
  },

  /** Load once (used by the Send gate so it does not refetch on every open). */
  async ensureLoaded(): Promise<void> {
    if (!state.loaded && !state.loading) await this.refresh();
  },

  async setEnabled(enabled: boolean): Promise<void> {
    const r = await send<SettingsReply>(MessageTypes.SET_REMOTE_SIGNING_ENABLED, { enabled });
    if (r.success && r.settings) state.settings = r.settings;
    // enabling/disabling changes the bridge -> refresh the visible device list.
    await this.refreshDevices();
  },

  /**
   * Sign (once) the wallet-control proof that endorses this device's relay-auth
   * key, under the user's spending auth. Cached in the background and attached to
   * every DEVICE_REGISTER so siblings can verify this device really controls the
   * wallet. Call at enable-time BEFORE setEnabled(true).
   */
  async produceProof(auth: { password?: string; privateKeyBytes?: number[] }): Promise<{ success: boolean; error?: string }> {
    const r = await send<{ success: boolean; error?: string }>(
      MessageTypes.PRODUCE_DEVICE_REGISTER_PROOF,
      auth as Record<string, unknown>,
    );
    return { success: !!r.success, error: r.error };
  },

  async setPolicy(policy: SigningPolicy): Promise<void> {
    const r = await send<SettingsReply>(MessageTypes.SET_CROSS_DEVICE_POLICY, { policy });
    if (r.success && r.settings) state.settings = r.settings;
  },

  /** Returns false when the device could not be pinned (e.g. it went offline). */
  async trust(deviceId: string): Promise<boolean> {
    const r = await send<SettingsReply>(MessageTypes.TRUST_CROSS_DEVICE, { deviceId });
    if (r.settings) state.settings = r.settings;
    await this.refreshDevices();
    return r.success;
  },

  async untrust(deviceId: string): Promise<void> {
    const r = await send<SettingsReply>(MessageTypes.UNTRUST_CROSS_DEVICE, { deviceId });
    if (r.success && r.settings) state.settings = r.settings;
    await this.refreshDevices();
  },

  async refreshDevices(): Promise<void> {
    const d = await send<DevicesReply>(MessageTypes.GET_CROSS_DEVICE_DEVICES);
    state.devices = d.success && d.devices ? d.devices : [];
  },

  /**
   * Mint the QR payload the phone scans (identity + wallet-control proof + a fresh
   * single-use nonce). Returns null when the wallet can't be paired (no cached proof
   * yet / no stake) so the dialog can prompt to re-enable.
   */
  async getPairingQr(): Promise<PairingQrPayload | null> {
    // `send` can resolve to undefined on a messaging failure (e.g. an MV3 worker
    // recycle mid-round-trip), so guard with optional chaining rather than throw —
    // the caller maps null to the dialog's error state.
    const r = await send<PairingQrReply | undefined>(MessageTypes.GET_PAIRING_QR);
    return r?.success && r.payload ? r.payload : null;
  },

  /** The last device paired via QR scan (background clears it on read). */
  async getPairingStatus(): Promise<PairedResult | null> {
    const r = await send<PairingStatusReply | undefined>(MessageTypes.GET_PAIRING_STATUS);
    return r?.success && r.paired ? r.paired : null;
  },

  // ---- getters -------------------------------------------------------------

  isEnabled(): boolean {
    return state.settings.enabled;
  },
  policy(): SigningPolicy {
    return state.settings.policy;
  },
  /**
   * A signing-capable device is PAIRED (persistent), online or not. Gates the "sign
   * on another device" button. Keyed on PAIRING, not live presence: keying it to the
   * live DEVICES snapshot hid the button whenever the phone was locked — the exact
   * moment the APNs wake exists for (a locked phone is evicted from the snapshot). The
   * flow stays fail-closed at approval time: an offline device cannot return a
   * verified SIGN_RESPONSE, so offering the button while paired-but-offline is safe.
   * (Previously required an ONLINE signer; widened to paired when APNs wake landed.)
   */
  hasTrustedSigner(): boolean {
    return hasPairedSigner(state.settings);
  },
  /**
   * A device is PAIRED (persistent), regardless of whether it is online right now.
   * Gates the "require a trusted device" option: presence flaps (phone sleeps, MV3
   * worker recycles), so keying the policy toggle to live presence made it grey out
   * constantly. The send flow stays fail-closed at approval time (an offline device
   * simply cannot approve), so arming the policy while paired-but-offline is safe.
   */
  hasPairedDevice(): boolean {
    return Object.keys(state.settings.trustedDevices).length > 0;
  },
  /** Send must be approved remotely (policy on + enabled). */
  requiresRemoteForSend(): boolean {
    return state.settings.enabled && state.settings.policy === 'require_remote';
  },
};

export default remoteSigningStore;
