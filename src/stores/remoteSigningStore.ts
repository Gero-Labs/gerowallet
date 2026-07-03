import Vue from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import {
  defaultRemoteSigningSettings,
  type RemoteSigningSettings,
  type SigningPolicy,
} from '@/services/crossDevice/crossDeviceTrust';
import type { DeviceInfo } from '@/services/crossDevice/protocol';

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

  // ---- getters -------------------------------------------------------------

  isEnabled(): boolean {
    return state.settings.enabled;
  },
  policy(): SigningPolicy {
    return state.settings.policy;
  },
  /** A trusted, signing-capable sibling exists -> remote signing can actually complete. */
  hasTrustedSigner(): boolean {
    return state.devices.some((e) => e.trusted && !e.isSelf && e.device.hasSigningKey);
  },
  /** Send must be approved remotely (policy on + enabled). */
  requiresRemoteForSend(): boolean {
    return state.settings.enabled && state.settings.policy === 'require_remote';
  },
};

export default remoteSigningStore;
