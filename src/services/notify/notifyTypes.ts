// Push notifications (gero-notify v1) — wire types of the signed REST API.
//
// CONTRACT.md v1.0.0-rc3 §2, §4. Nothing here touches chrome or the network;
// the shapes are exactly what the server sends and accepts. Unknown fields on
// responses are ignored by the readers (§2.3), so every interface is open-ended.

export const NOTIFY_PROTOCOL = 1;

export type NotifyTransport = 'webpush' | 'apns' | 'none';
export type WireNetwork = 'cardano-mainnet' | 'cardano-preprod' | 'cardano-preview';

/** `GET /config` (§4.1). Public, cacheable, refetched on every registering start. */
export interface NotifyConfig {
  protocol: number;
  protocols: number[];
  minClientProtocol: number;
  enabled: boolean;
  vapidPublicKey: string | null;
  vapidKid: string | null;
  categories: string[];
  securityCategories: string[];
  networks: string[];
  servedCategories: Record<string, Record<string, string[]>>;
  limits: { walletsPerDevice: number; devicesPerWallet: number; paymentCredsPerLink: number; paymentCredsPerWallet: number };
  serverTime: number;
}

/** `PUT /device` body (§4.2), Web Push flavour; `transport: 'none'` carries no target. */
export interface DeviceBody {
  protocol: number;
  relayPubKey: string;
  platform: 'extension';
  appVersion: string;
  locale?: string;
  osPermission: boolean;
  transport: NotifyTransport;
  webpush?: WebPushTarget;
}

/** From `PushSubscription.toJSON()` plus the `/config` kid it was created with. */
export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
  vapidKid: string;
  expirationTime: number | null;
}

export type TargetStatus = 'active' | 'none' | 'invalid';

export interface DeviceTargetView {
  transport: NotifyTransport;
  status: TargetStatus;
  invalidReason?: string;
  invalidSince?: number;
}

export interface DeviceWalletLinkView {
  walletTag: string;
  network: string;
  muted: boolean;
}

/** `PUT /device` and `GET /device` response (§4.2, §4.3). `created` only on PUT. */
export interface DeviceView {
  deviceId: string;
  created?: boolean;
  target: DeviceTargetView;
  wallets: DeviceWalletLinkView[];
  servedCategories: Record<string, string[]>;
  reassertAfterMs: number;
  serverTime: number;
}

export interface SyncedPrefs {
  categoriesOff: string[];
  showAmounts: boolean;
  minReceiveLovelace: number;
  updatedAt: number | null;
}

export interface DevicePrefs {
  muted: boolean;
}

export interface WalletPrefs {
  synced: SyncedPrefs;
  device: DevicePrefs;
}

/** `PUT …/prefs` body (§4.8): a present section replaces that section. */
export interface WalletPrefsWrite {
  synced?: Omit<SyncedPrefs, 'updatedAt'>;
  device?: DevicePrefs;
}

/** The stored DeviceRegisterProof; the server ignores the extra `stakeAddress` (§3.7). */
export interface WalletProof {
  coseSign1: string;
  coseKey: string;
  stakeAddress?: string;
}

/** `PUT /device/wallets/{walletTag}` body (§4.5). `seedPrefs` is never sent by the extension. */
export interface WalletLinkBody {
  network: string;
  stakeAddress: string;
  proof: WalletProof;
  paymentCreds: string[];
  eventKey: string;
}

export interface WalletLinkView {
  walletTag: string;
  created: boolean;
  prefs: WalletPrefs;
  servedCategories: Record<string, string[]>;
  credentialCoverage: { link: number; wallet: number; walletTruncated: number };
}

/** §2.5 error envelope. `message` is for logs only, never for the user. */
export interface NotifyErrorBody {
  error: { code: string; message?: string; details?: Record<string, unknown> };
}

export const NOTIFY_ERROR_CODES = [
  'invalid_json', 'query_not_allowed', 'auth_missing', 'auth_malformed', 'auth_clock_skew', 'auth_bad_signature',
  'auth_replay', 'device_unknown', 'not_found', 'wallet_not_registered', 'method_not_allowed', 'device_key_mismatch',
  'wallet_tag_conflict', 'target_invalid', 'body_too_large', 'unsupported_media_type', 'invalid_field',
  'unsupported_network', 'unsupported_stake_credential', 'proof_invalid', 'limit_exceeded', 'category_not_mutable',
  'endpoint_not_allowed', 'vapid_kid_stale', 'client_protocol_unsupported', 'rate_limited', 'internal', 'unavailable',
  'nonce_store_unavailable',
] as const;
export type NotifyErrorCode = typeof NOTIFY_ERROR_CODES[number];
