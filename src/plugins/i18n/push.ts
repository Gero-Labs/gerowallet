// Push notification strings (handover B6). The service worker renders every push
// from THIS table only (contract §6.7 rule 8: no payload string is ever shown), so
// it cannot load vue-i18n; the same object is merged into the vue-i18n messages
// (plugins/i18n.ts) so the settings UI and translators see one set of keys.
//
// Key names follow the APNs loc-keys of contract §6.2 so both clients stay
// aligned; titles mirror iOS AppNotifications.swift. `{ada}`, `{amount}`, `{n}`
// and `{wallet}` are interpolated by notifyRender.ts. The DRep text never names
// the DRep.

export const PUSH_LOCALES = ['us', 'de', 'es'] as const;
export type PushLocale = typeof PUSH_LOCALES[number];

export type PushStringKey =
  | 'PUSH_GENERIC_TITLE' | 'PUSH_GENERIC_BODY'
  | 'PUSH_CATEGORY_FUNDS' | 'PUSH_CATEGORY_STAKING' | 'PUSH_CATEGORY_SWAP' | 'PUSH_CATEGORY_ADAM' | 'PUSH_CATEGORY_GOVERNANCE' | 'PUSH_CATEGORY_REMOTESIGNING' | 'PUSH_CATEGORY_SYSTEM'
  | 'PUSH_FUNDS_TITLE' | 'PUSH_FUNDS_BODY' | 'PUSH_FUNDS_BODY_AMOUNT'
  | 'PUSH_FUNDS_SUMMARY_TITLE' | 'PUSH_FUNDS_SUMMARY_BODY' | 'PUSH_FUNDS_SUMMARY_BODY_ONE'
  | 'PUSH_SIGNWAKE_TITLE' | 'PUSH_SIGNWAKE_BODY'
  | 'PUSH_NEWDEVICE_TITLE' | 'PUSH_NEWDEVICE_BODY'
  | 'PUSH_REWARD_TITLE' | 'PUSH_REWARD_BODY' | 'PUSH_REWARD_BODY_AMOUNT'
  | 'PUSH_SWAP_FILLED_TITLE' | 'PUSH_SWAP_FILLED_BODY' | 'PUSH_SWAP_CANCELLED_TITLE' | 'PUSH_SWAP_CANCELLED_BODY'
  | 'PUSH_ADAM_TITLE' | 'PUSH_ADAM_BODY'
  | 'PUSH_DREP_RETIRED_TITLE' | 'PUSH_DREP_RETIRED_BODY' | 'PUSH_DREP_INACTIVE_TITLE' | 'PUSH_DREP_INACTIVE_BODY' | 'PUSH_DREP_EXPIRING_TITLE' | 'PUSH_DREP_EXPIRING_BODY'
  | 'PUSH_TEST_TITLE' | 'PUSH_TEST_BODY'
  | 'PUSH_AMOUNT_ADA' | 'PUSH_AMOUNT_OTHER_ONE' | 'PUSH_AMOUNT_OTHER' | 'PUSH_AMOUNT_JOIN'
  | 'PUSH_TOAST_VIEW' | 'PUSH_TOAST_DISMISS';

export const pushStrings: Record<PushLocale, Record<PushStringKey, string>> = {
  us: {
    PUSH_GENERIC_TITLE: 'Gero',
    PUSH_GENERIC_BODY: 'You have new wallet activity',
    PUSH_CATEGORY_FUNDS: 'You received funds',
    PUSH_CATEGORY_STAKING: 'There is news about your staking',
    PUSH_CATEGORY_SWAP: 'There is news about a swap order',
    PUSH_CATEGORY_ADAM: 'There is a new ADAM proposal',
    PUSH_CATEGORY_GOVERNANCE: 'There is news about your governance delegation',
    PUSH_CATEGORY_REMOTESIGNING: 'There is a security event on this wallet',
    PUSH_CATEGORY_SYSTEM: 'A notification from Gero',
    PUSH_FUNDS_TITLE: 'ADA Received',
    PUSH_FUNDS_BODY: 'You received funds',
    PUSH_FUNDS_BODY_AMOUNT: 'You received {amount}',
    PUSH_FUNDS_SUMMARY_TITLE: 'Funds Received',
    PUSH_FUNDS_SUMMARY_BODY: '{n} more transactions',
    PUSH_FUNDS_SUMMARY_BODY_ONE: '1 more transaction',
    PUSH_SIGNWAKE_TITLE: 'Signing request',
    PUSH_SIGNWAKE_BODY: 'A device is waiting for your approval',
    PUSH_NEWDEVICE_TITLE: 'New device on this wallet',
    PUSH_NEWDEVICE_BODY: 'A new device was paired with this wallet. Review it under Settings, Security.',
    PUSH_REWARD_TITLE: 'Staking Reward Received',
    PUSH_REWARD_BODY: 'Your staking reward has arrived',
    PUSH_REWARD_BODY_AMOUNT: 'Your staking reward of {ada} ADA has arrived',
    PUSH_SWAP_FILLED_TITLE: 'Swap Filled',
    PUSH_SWAP_FILLED_BODY: 'Your swap order was filled',
    PUSH_SWAP_CANCELLED_TITLE: 'Order Cancelled',
    PUSH_SWAP_CANCELLED_BODY: 'Your swap order was cancelled',
    PUSH_ADAM_TITLE: 'ADAM proposal',
    PUSH_ADAM_BODY: 'ADAM proposes a trade for your review',
    PUSH_DREP_RETIRED_TITLE: 'DRep retired',
    PUSH_DREP_RETIRED_BODY: 'The DRep you delegate to has retired. Choose a new one to keep your voting power.',
    PUSH_DREP_INACTIVE_TITLE: 'DRep inactive',
    PUSH_DREP_INACTIVE_BODY: 'The DRep you delegate to has become inactive.',
    PUSH_DREP_EXPIRING_TITLE: 'DRep about to expire',
    PUSH_DREP_EXPIRING_BODY: 'The DRep you delegate to is about to expire.',
    PUSH_TEST_TITLE: 'Test notification',
    PUSH_TEST_BODY: 'Notifications from Gero are working.',
    PUSH_AMOUNT_ADA: '{ada} ADA',
    PUSH_AMOUNT_OTHER_ONE: '1 other token',
    PUSH_AMOUNT_OTHER: '{n} other tokens',
    PUSH_AMOUNT_JOIN: ', ',
    PUSH_TOAST_VIEW: 'View',
    PUSH_TOAST_DISMISS: 'Dismiss',
  },
  de: {
    PUSH_GENERIC_TITLE: 'Gero',
    PUSH_GENERIC_BODY: 'Es gibt neue Aktivität in deiner Wallet',
    PUSH_CATEGORY_FUNDS: 'Du hast Guthaben erhalten',
    PUSH_CATEGORY_STAKING: 'Es gibt Neuigkeiten zu deinem Staking',
    PUSH_CATEGORY_SWAP: 'Es gibt Neuigkeiten zu einem Swap-Auftrag',
    PUSH_CATEGORY_ADAM: 'Es gibt einen neuen ADAM-Vorschlag',
    PUSH_CATEGORY_GOVERNANCE: 'Es gibt Neuigkeiten zu deiner Governance-Delegation',
    PUSH_CATEGORY_REMOTESIGNING: 'Es gibt ein Sicherheitsereignis in dieser Wallet',
    PUSH_CATEGORY_SYSTEM: 'Eine Benachrichtigung von Gero',
    PUSH_FUNDS_TITLE: 'ADA erhalten',
    PUSH_FUNDS_BODY: 'Du hast Guthaben erhalten',
    PUSH_FUNDS_BODY_AMOUNT: 'Du hast {amount} erhalten',
    PUSH_FUNDS_SUMMARY_TITLE: 'Guthaben erhalten',
    PUSH_FUNDS_SUMMARY_BODY: '{n} weitere Transaktionen',
    PUSH_FUNDS_SUMMARY_BODY_ONE: '1 weitere Transaktion',
    PUSH_SIGNWAKE_TITLE: 'Signieranfrage',
    PUSH_SIGNWAKE_BODY: 'Ein Gerät wartet auf deine Freigabe',
    PUSH_NEWDEVICE_TITLE: 'Neues Gerät in dieser Wallet',
    PUSH_NEWDEVICE_BODY: 'Ein neues Gerät wurde mit dieser Wallet gekoppelt. Prüfe es unter Einstellungen, Sicherheit.',
    PUSH_REWARD_TITLE: 'Staking-Belohnung erhalten',
    PUSH_REWARD_BODY: 'Deine Staking-Belohnung ist eingegangen',
    PUSH_REWARD_BODY_AMOUNT: 'Deine Staking-Belohnung von {ada} ADA ist eingegangen',
    PUSH_SWAP_FILLED_TITLE: 'Swap ausgeführt',
    PUSH_SWAP_FILLED_BODY: 'Dein Swap-Auftrag wurde ausgeführt',
    PUSH_SWAP_CANCELLED_TITLE: 'Auftrag storniert',
    PUSH_SWAP_CANCELLED_BODY: 'Dein Swap-Auftrag wurde storniert',
    PUSH_ADAM_TITLE: 'ADAM-Vorschlag',
    PUSH_ADAM_BODY: 'ADAM schlägt dir einen Handel zur Prüfung vor',
    PUSH_DREP_RETIRED_TITLE: 'DRep zurückgetreten',
    PUSH_DREP_RETIRED_BODY: 'Der DRep, an den du delegierst, ist zurückgetreten. Wähle einen neuen, um deine Stimmkraft zu behalten.',
    PUSH_DREP_INACTIVE_TITLE: 'DRep inaktiv',
    PUSH_DREP_INACTIVE_BODY: 'Der DRep, an den du delegierst, ist inaktiv geworden.',
    PUSH_DREP_EXPIRING_TITLE: 'DRep läuft bald ab',
    PUSH_DREP_EXPIRING_BODY: 'Der DRep, an den du delegierst, läuft bald ab.',
    PUSH_TEST_TITLE: 'Testbenachrichtigung',
    PUSH_TEST_BODY: 'Benachrichtigungen von Gero funktionieren.',
    PUSH_AMOUNT_ADA: '{ada} ADA',
    PUSH_AMOUNT_OTHER_ONE: '1 weiterer Token',
    PUSH_AMOUNT_OTHER: '{n} weitere Token',
    PUSH_AMOUNT_JOIN: ', ',
    PUSH_TOAST_VIEW: 'Ansehen',
    PUSH_TOAST_DISMISS: 'Schließen',
  },
  es: {
    PUSH_GENERIC_TITLE: 'Gero',
    PUSH_GENERIC_BODY: 'Hay actividad nueva en tu billetera',
    PUSH_CATEGORY_FUNDS: 'Recibiste fondos',
    PUSH_CATEGORY_STAKING: 'Hay novedades sobre tu staking',
    PUSH_CATEGORY_SWAP: 'Hay novedades sobre una orden de intercambio',
    PUSH_CATEGORY_ADAM: 'Hay una nueva propuesta de ADAM',
    PUSH_CATEGORY_GOVERNANCE: 'Hay novedades sobre tu delegación de gobernanza',
    PUSH_CATEGORY_REMOTESIGNING: 'Hay un evento de seguridad en esta billetera',
    PUSH_CATEGORY_SYSTEM: 'Una notificación de Gero',
    PUSH_FUNDS_TITLE: 'ADA recibido',
    PUSH_FUNDS_BODY: 'Recibiste fondos',
    PUSH_FUNDS_BODY_AMOUNT: 'Recibiste {amount}',
    PUSH_FUNDS_SUMMARY_TITLE: 'Fondos recibidos',
    PUSH_FUNDS_SUMMARY_BODY: '{n} transacciones más',
    PUSH_FUNDS_SUMMARY_BODY_ONE: '1 transacción más',
    PUSH_SIGNWAKE_TITLE: 'Solicitud de firma',
    PUSH_SIGNWAKE_BODY: 'Un dispositivo está esperando tu aprobación',
    PUSH_NEWDEVICE_TITLE: 'Nuevo dispositivo en esta billetera',
    PUSH_NEWDEVICE_BODY: 'Se vinculó un nuevo dispositivo a esta billetera. Revísalo en Configuración, Seguridad.',
    PUSH_REWARD_TITLE: 'Recompensa de staking recibida',
    PUSH_REWARD_BODY: 'Llegó tu recompensa de staking',
    PUSH_REWARD_BODY_AMOUNT: 'Llegó tu recompensa de staking de {ada} ADA',
    PUSH_SWAP_FILLED_TITLE: 'Intercambio completado',
    PUSH_SWAP_FILLED_BODY: 'Tu orden de intercambio se completó',
    PUSH_SWAP_CANCELLED_TITLE: 'Orden cancelada',
    PUSH_SWAP_CANCELLED_BODY: 'Tu orden de intercambio se canceló',
    PUSH_ADAM_TITLE: 'Propuesta de ADAM',
    PUSH_ADAM_BODY: 'ADAM te propone una operación para que la revises',
    PUSH_DREP_RETIRED_TITLE: 'DRep retirado',
    PUSH_DREP_RETIRED_BODY: 'El DRep al que delegas se retiró. Elige uno nuevo para conservar tu poder de voto.',
    PUSH_DREP_INACTIVE_TITLE: 'DRep inactivo',
    PUSH_DREP_INACTIVE_BODY: 'El DRep al que delegas quedó inactivo.',
    PUSH_DREP_EXPIRING_TITLE: 'DRep a punto de expirar',
    PUSH_DREP_EXPIRING_BODY: 'El DRep al que delegas está a punto de expirar.',
    PUSH_TEST_TITLE: 'Notificación de prueba',
    PUSH_TEST_BODY: 'Las notificaciones de Gero funcionan.',
    PUSH_AMOUNT_ADA: '{ada} ADA',
    PUSH_AMOUNT_OTHER_ONE: '1 token más',
    PUSH_AMOUNT_OTHER: '{n} tokens más',
    PUSH_AMOUNT_JOIN: ', ',
    PUSH_TOAST_VIEW: 'Ver',
    PUSH_TOAST_DISMISS: 'Descartar',
  },
};
