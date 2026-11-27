// A seam between the push handler (notifyBackground / notifyPush) and the GeroVault invitation
// service, as announcementHooks is for announcements: the push side imports only this file, and
// vaultInviteBackground binds the real lookup. Until then a vault push shows the generic line.
import type { VaultPushLookup } from '@/services/notify/notifyPush';

export const vaultInviteHooks: {
  /** Fetch and open what a vault push points at, or null. */
  forPush: (t: string, setupId: string) => Promise<VaultPushLookup | null>;
} = {
  forPush: async () => null,
};
