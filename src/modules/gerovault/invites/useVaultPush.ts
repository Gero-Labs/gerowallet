/**
 * A `vault_invite` / `vault_response` push that arrives while a vault page is open refreshes it at
 * once. The worker has already fetched and opened what the push points at and written one row to
 * the notification inbox (`notifyPush.handleVaultPush`); pages mirror that inbox
 * (`notifyInboxStore`), so a new or repeated vault row is the signal. Nothing is read from the
 * row but its type and setup id: what the page shows comes from the background, as always.
 */
import { getCurrentScope, onScopeDispose, watch } from 'vue';
import { notifyInboxStore, type NotifyInboxItem } from '@/stores/notifyInboxStore';

export type VaultPushType = 'vault_invite' | 'vault_response';

export interface VaultPushEvent {
  readonly t: VaultPushType;
  /** The setup the push points at (hex16), when the row carries one. */
  readonly setupId?: string;
}

const isVaultRow = (i: NotifyInboxItem): boolean => i.d === 'vault' && (i.t === 'vault_invite' || i.t === 'vault_response');

/** One mark per vault row: a repeated push for the same setup replaces its row with a new time. */
export function vaultPushMarks(items: readonly NotifyInboxItem[]): Map<string, { ts: number; event: VaultPushEvent }> {
  const marks = new Map<string, { ts: number; event: VaultPushEvent }>();
  for (const i of items) {
    if (!isVaultRow(i)) continue;
    const setupId = typeof i.x?.['setupId'] === 'string' && /^[0-9a-f]{32}$/.test(i.x['setupId']) ? i.x['setupId'] : undefined;
    marks.set(i.e, { ts: i.ts, event: { t: i.t as VaultPushType, ...(setupId ? { setupId } : {}) } });
  }
  return marks;
}

/** The pushes in `next` that `previous` did not hold (a new row, or the same row with another time). */
export function newVaultPushes(previous: ReadonlyMap<string, { ts: number }>, next: ReadonlyMap<string, { ts: number; event: VaultPushEvent }>): VaultPushEvent[] {
  const out: VaultPushEvent[] = [];
  for (const [e, mark] of next) {
    if (previous.get(e)?.ts !== mark.ts) out.push(mark.event);
  }
  return out;
}

/**
 * Calls `onPush` for every vault push that arrives from now on. `items` is injected in tests; a
 * page uses the inbox store. The rows already there when the inbox first loads are not pushes.
 */
export function useVaultPush(onPush: (event: VaultPushEvent) => void, source: { items(): readonly NotifyInboxItem[]; loaded(): boolean } = inboxSource()): void {
  let seen: Map<string, { ts: number }> | null = source.loaded() ? vaultPushMarks(source.items()) : null;
  const stop = watch(() => [source.loaded(), source.items()] as const, ([loaded, items]) => {
    if (!loaded) return;
    const next = vaultPushMarks(items);
    const fresh = seen ? newVaultPushes(seen, next) : [];
    seen = next;
    for (const event of fresh) onPush(event);
  });
  if (getCurrentScope()) onScopeDispose(stop);
}

function inboxSource() {
  notifyInboxStore.init();
  return { items: () => notifyInboxStore.state.items, loaded: () => notifyInboxStore.state.loaded };
}
