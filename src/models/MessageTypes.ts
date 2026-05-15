export enum MessageTypes {
  SIGN_DATA = 'SIGN_DATA',
  SIGN_TX = 'SIGN_TX',
  SIGN_BITCOIN_TX = 'SIGN_BITCOIN_TX',
  SIGN_BITCOIN_TX_HARDWARE = 'SIGN_BITCOIN_TX_HARDWARE',
  SEND_BITCOIN = 'SEND_BITCOIN',
  SYNC_BITCOIN = 'SYNC_BITCOIN',
  BABYLON_STAKE = 'BABYLON_STAKE',
  SUBMIT_TX = 'SUBMIT_TX',
  VERIFY_SPENDING_PASSWORD = 'VERIFY_SPENDING_PASSWORD',
  SIGN_WITH_GOOGLE = 'SIGN_WITH_GOOGLE',
  ACTIVATE_GOOGLE_WALLET = 'ACTIVATE_GOOGLE_WALLET',
  RESTORE = 'RESTORE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOCK = 'LOCK',
  UNLOCK = 'UNLOCK',
  VERIFY_PRE_LOGIN_UNLOCK = 'VERIFY_PRE_LOGIN_UNLOCK',
  RESYNC = 'RESYNC',
  SYNC_VIA_REST = 'SYNC_VIA_REST',
  TREZOR = 'TREZOR',
  REMOVE_PENDING_TRANSACTION = 'REMOVE_PENDING_TRANSACTION',
  CHECK_AUTO_LOCK = 'CHECK_AUTO_LOCK',
  OPEN_SIDE_PANEL = 'OPEN_SIDE_PANEL',
  SET_OPEN_MINI_GERO_ON_CLICK = 'SET_OPEN_MINI_GERO_ON_CLICK',
  BITCOIN_DAPP_SIGN_PSBT = 'BITCOIN_DAPP_SIGN_PSBT',
  BITCOIN_DAPP_SIGN_MESSAGE = 'BITCOIN_DAPP_SIGN_MESSAGE',
  // Pool Operator (SPO)
  SIGN_TX_WITH_POOL_KEYS = 'SIGN_TX_WITH_POOL_KEYS',
  SPO_NODE_FETCH = 'SPO_NODE_FETCH',
  // WalletConnect
  WC_PAIR = 'WC_PAIR',
  WC_APPROVE_SESSION = 'WC_APPROVE_SESSION',
  WC_REJECT_SESSION = 'WC_REJECT_SESSION',
  WC_DISCONNECT_SESSION = 'WC_DISCONNECT_SESSION',
  WC_GET_SESSIONS = 'WC_GET_SESSIONS',
  WC_RESPOND_REQUEST = 'WC_RESPOND_REQUEST',
  // Midnight: persist a re-derived publicKey JSON (3 addresses) for an existing
  // Midnight wallet. Used by the legacy-wallet upgrade path when the persisted
  // publicKey is missing the dust address (created before SDK integration).
  UPDATE_MIDNIGHT_PUBLIC_KEY = 'UPDATE_MIDNIGHT_PUBLIC_KEY',
  // Midnight: sign a list of intent-hash segments with the user's role-derived
  // key (NightExternal for unshielded, Zswap for shielded). Browser passes raw
  // segment bytes; BG decrypts the mnemonic, derives the role key, signs each
  // segment (BIP-340), wipes the key, returns signatures. The SDK's signSegment
  // callback is implemented as a thin wrapper around this BG round-trip.
  SIGN_MIDNIGHT_SEGMENTS = 'SIGN_MIDNIGHT_SEGMENTS',
  // Midnight: submit a fully-signed (and proven, for shielded) transaction via
  // Nexus's /tx/submit relay. Nexus forwards to the Midnight RPC node and
  // returns the txHash + status (Submitted / InBlock / Finalized).
  SUBMIT_MIDNIGHT_TX = 'SUBMIT_MIDNIGHT_TX',
  // Midnight: retrieve the wallet's publicKeyHex + addressHex needed by the
  // Nexus sidecar for seedless wallet construction. Fast path: returns cached
  // values from the wallet record without decryption. Slow path (legacy wallets
  // that were created before this field was stored): decrypts mnemonic once,
  // derives the keys, persists them back to DB, returns them.
  GET_MIDNIGHT_WALLET_KEYS = 'GET_MIDNIGHT_WALLET_KEYS',
}
