export interface BellBadge {
  visible: boolean;
  content: string | undefined;
  dot: boolean;
  color: string;
}

/**
 * The dashboard bell's badge. Every "Needs you" source lights it: the SPO key warning, unread
 * inbox rows (the sticky security items) and the items stuck on a closed marketplace. An unread
 * count and a dot for stuck items alone take the accent; the error dot is the key warning's.
 */
export function bellBadge({ kesVisible, unread, legacyCount }: { kesVisible: boolean; unread: number; legacyCount: number }): BellBadge {
  return {
    visible: kesVisible || unread > 0 || legacyCount > 0,
    content: unread > 0 ? String(unread) : undefined,
    dot: unread === 0,
    color: unread === 0 && kesVisible ? 'error' : 'var(--g-accent)',
  };
}
