/**
 * One-shot handoff for a DRep delegation started in the side panel.
 *
 * The panel has no signing surface for certificate transactions — hardware
 * wallets, PassKey/PRF and Keystone all go through the dashboard's
 * `DRepDelegateDialog` — so "Confirm Delegation" parks the user's choice here
 * and opens `index.html#/governance`. The governance page picks it up (on mount,
 * or via `chrome.storage.onChanged` when that tab is already open) and opens the
 * delegate dialog with the transaction already built.
 *
 * Before this existed the panel opened the dashboard and dropped the selection
 * on the floor, so the button appeared to do nothing.
 */

export const PENDING_DREP_DELEGATION_KEY = 'pendingDRepDelegation';

/** Minimal DRep row — the shape both sides already build from the governance API. */
export interface PendingDRep {
  id: string;
  name?: string;
  image?: string;
  hex?: string;
  has_script?: boolean;
  delegators?: number;
  votes?: number;
  voting_power?: number;
}

export interface PendingDRepDelegation {
  /** 'drep' carries a specific DRep; the others are the quick-delegate options. */
  kind: 'drep' | 'abstain' | 'noConfidence';
  drep?: PendingDRep;
  createdAt: number;
}

// A handoff is only meaningful for the trip from the panel to the dashboard.
// Anything older was abandoned (tab closed, wallet locked, browser restarted)
// and must never resurface later as a signing dialog the user didn't ask for.
const MAX_AGE_MS = 5 * 60 * 1000;

function isUsable(value: unknown): value is PendingDRepDelegation {
  const pending = value as PendingDRepDelegation | undefined;
  if (!pending || typeof pending !== 'object') return false;
  if (pending.kind !== 'drep' && pending.kind !== 'abstain' && pending.kind !== 'noConfidence') return false;
  if (pending.kind === 'drep' && !pending.drep?.id) return false;
  return typeof pending.createdAt === 'number' && Date.now() - pending.createdAt <= MAX_AGE_MS;
}

/**
 * Park a delegation for the dashboard. Must be awaited BEFORE opening/focusing
 * the dashboard tab, so a freshly created tab finds it on mount.
 */
export async function setPendingDRepDelegation(
  pending: Omit<PendingDRepDelegation, 'createdAt'>,
): Promise<void> {
  await chrome.storage.local.set({
    [PENDING_DREP_DELEGATION_KEY]: { ...pending, createdAt: Date.now() },
  });
}

/**
 * Read and clear the parked delegation. Always clears, even when the payload is
 * stale or malformed — a handoff is consumed exactly once.
 */
export async function takePendingDRepDelegation(): Promise<PendingDRepDelegation | null> {
  try {
    const stored = await chrome.storage.local.get(PENDING_DREP_DELEGATION_KEY);
    const pending = stored?.[PENDING_DREP_DELEGATION_KEY];
    if (pending === undefined) return null;
    await chrome.storage.local.remove(PENDING_DREP_DELEGATION_KEY);
    return isUsable(pending) ? pending : null;
  } catch (error) {
    console.warn('takePendingDRepDelegation: failed to read handoff', error);
    return null;
  }
}

/**
 * Fire when a delegation is parked while this page is already open (the panel
 * focused an existing dashboard tab that is sitting on /governance, so nothing
 * remounts). Returns an unsubscribe function.
 */
export function onPendingDRepDelegation(
  handler: (pending: PendingDRepDelegation) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    // Only react to a write. The remove that take() performs also fires here,
    // with no newValue — ignoring it is what keeps this from looping.
    if (areaName !== 'local' || !changes[PENDING_DREP_DELEGATION_KEY]?.newValue) return;
    void takePendingDRepDelegation().then((pending) => {
      if (pending) handler(pending);
    });
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
