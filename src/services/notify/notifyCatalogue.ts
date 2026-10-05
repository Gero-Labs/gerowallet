/** Every alert the wallet renders (notifyRender EVENT_KEYS minus `test`), by category, for the settings list. */
export interface NotifyAlertType {
  id: string;
  category: string;
  /** Security alerts are always on (CONTRACT.md 7.1); listed, never switchable. */
  security: boolean;
}

export const NOTIFY_ALERT_TYPES: readonly NotifyAlertType[] = [
  { id: 'funds', category: 'funds', security: false },
  { id: 'funds_summary', category: 'funds', security: false },
  { id: 'reward', category: 'staking', security: false },
  { id: 'swap_filled', category: 'swap', security: false },
  { id: 'swap_cancelled', category: 'swap', security: false },
  { id: 'adam_proposal', category: 'adam', security: false },
  { id: 'drep_retired', category: 'governance', security: false },
  { id: 'drep_inactive', category: 'governance', security: false },
  { id: 'drep_expiring', category: 'governance', security: false },
  { id: 'new_device', category: 'remoteSigning', security: true },
  { id: 'signwake', category: 'remoteSigning', security: true },
];

export function alertTypesFor(category: string): NotifyAlertType[] {
  return NOTIFY_ALERT_TYPES.filter((t) => t.category === category);
}
