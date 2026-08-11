export enum MessageTypes {
  SIGN_DATA = 'SIGN_DATA',
  SIGN_TX = 'SIGN_TX',
  /** Register a Nexus-pool collateral ref the SERVER lent (first-party dust flows),
   *  so SIGN_TX's cosign loop treats a co-sign failure on it as fatal. */
  MARK_NEXUS_LENT = 'MARK_NEXUS_LENT',
  SIGN_BITCOIN_TX = 'SIGN_BITCOIN_TX',
  SIGN_BITCOIN_TX_HARDWARE = 'SIGN_BITCOIN_TX_HARDWARE',
  SEND_BITCOIN = 'SEND_BITCOIN',
  SYNC_BITCOIN = 'SYNC_BITCOIN',
  BABYLON_STAKE = 'BABYLON_STAKE',
  SUBMIT_TX = 'SUBMIT_TX',
  REQUEST_CROSS_DEVICE_SIGNATURE = 'REQUEST_CROSS_DEVICE_SIGNATURE',
  // Remote-signing settings (trusted devices + policy) — Security tab
  GET_CROSS_DEVICE_SETTINGS = 'GET_CROSS_DEVICE_SETTINGS',
  GET_CROSS_DEVICE_DEVICES = 'GET_CROSS_DEVICE_DEVICES',
  SET_REMOTE_SIGNING_ENABLED = 'SET_REMOTE_SIGNING_ENABLED',
  SET_CROSS_DEVICE_POLICY = 'SET_CROSS_DEVICE_POLICY',
  // XDP (Cross-Device Proving) serving toggles — master + per pinned device.
  SET_SERVE_PROOFS_ENABLED = 'SET_SERVE_PROOFS_ENABLED',
  SET_DEVICE_SERVE_PROOFS = 'SET_DEVICE_SERVE_PROOFS',
  TRUST_CROSS_DEVICE = 'TRUST_CROSS_DEVICE',
  UNTRUST_CROSS_DEVICE = 'UNTRUST_CROSS_DEVICE',
  PRODUCE_DEVICE_REGISTER_PROOF = 'PRODUCE_DEVICE_REGISTER_PROOF',
  // QR scan-to-pair: mint the QR payload the phone scans; poll the last pair result.
  GET_PAIRING_QR = 'GET_PAIRING_QR',
  GET_PAIRING_STATUS = 'GET_PAIRING_STATUS',
  VERIFY_SPENDING_PASSWORD = 'VERIFY_SPENDING_PASSWORD',
  SIGN_WITH_GOOGLE = 'SIGN_WITH_GOOGLE',
  // MPC "Sign in with Google" wallet (Plan D)
  CREATE_MPC_GOOGLE_WALLET = 'CREATE_MPC_GOOGLE_WALLET',
  UNLOCK_MPC_WALLET = 'UNLOCK_MPC_WALLET',
  RECOVER_MPC_GOOGLE_WALLET = 'RECOVER_MPC_GOOGLE_WALLET',
  CHECK_MPC_ENROLLMENT = 'CHECK_MPC_ENROLLMENT',
  DEREGISTER_MPC_ACCOUNT = 'DEREGISTER_MPC_ACCOUNT',
  HAS_MPC_SESSION = 'HAS_MPC_SESSION',
  STORE_MPC_RECOVERY = 'STORE_MPC_RECOVERY',
  REVEAL_MPC_SRP = 'REVEAL_MPC_SRP',
  SET_RECOVERY_PASSWORD = 'SET_RECOVERY_PASSWORD',
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
  // Midnight: take the unproven unshielded NIGHT-transfer tx Nexus built,
  // add DUST fee inputs locally (needs the user's real dust secret to derive
  // spend nullifiers), sign each input with NightExternal, return the
  // signed-but-unproven hex. Sidecar's /tx/finalize then proves + binds +
  // submits. The build step (NIGHT input/output/change) is on Nexus because
  // those UTxOs are public; the indexer-backed view there is canonical.
  BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX = 'BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX',
  // Midnight: build + sign a shielded NIGHT transfer entirely in BG. Unlike
  // unshielded, shielded notes are encrypted to the user's Zswap viewing key
  // so only the wallet can build the tx. BG: decrypts mnemonic, derives
  // ZswapSecretKeys, runs ShieldedWallet.transferTransaction, returns
  // signed-but-unproven tx hex. Markers: SignatureEnabled / PreProof /
  // PreBinding. Sidecar's /tx/prove-and-submit takes it from there.
  //
  // Privacy: the returned hex carries witness data linking the user's notes
  // to this spend. Caller (UI) must surface the explicit consent for routing
  // it through Gero Cloud proving — see ShieldedProvingConsentDialog.
  BUILD_AND_SIGN_MIDNIGHT_SHIELDED_TX = 'BUILD_AND_SIGN_MIDNIGHT_SHIELDED_TX',
  // Midnight: build + sign the SHIELD direction of a shield/unshield
  // conversion (public NIGHT -> private/shielded NIGHT, always between the
  // wallet's OWN two addresses — no recipient field). BG merges a
  // Nexus-built unshielded half (swap mode) with a client-side
  // ShieldedWallet.initSwap shielded half, balances DUST once against the
  // combined tx, and returns signed-but-unproven hex by default (or
  // finalized hex when `proving` is supplied). Unshield is
  // not wired yet (ground rule 16).
  BUILD_AND_SIGN_MIDNIGHT_SHIELD_TX = 'BUILD_AND_SIGN_MIDNIGHT_SHIELD_TX',
  // Midnight: record the user's consent to ship shielded-tx witness data to
  // Gero Cloud for proving. Browser routes the consent click here so BG can
  // persist + broadcast to every connected browser context (the user
  // accepting in options should also unlock the popup's send dialog).
  ACCEPT_MIDNIGHT_SHIELDED_PROVING_CONSENT = 'ACCEPT_MIDNIGHT_SHIELDED_PROVING_CONSENT',
  // Midnight: persist the user's proof-server preference (Gero Cloud vs a
  // local self-hosted docker proof server). Browser routes the Settings UI's
  // proof-server section here so BG can persist + broadcast to every
  // connected browser context, mirroring ACCEPT_MIDNIGHT_SHIELDED_PROVING_CONSENT
  // above. See midnightStore.setProofServer.
  SET_MIDNIGHT_PROOF_SERVER = 'SET_MIDNIGHT_PROOF_SERVER',
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
  // Midnight: sign + submit a Cardano-side DUST registration tx using the
  // wallet's same mnemonic. The wallet has both Midnight and CIP-1852 Cardano
  // keys derived from one BIP39 phrase (matching the reference implementation). This BG message:
  //   1. Decrypts the mnemonic (password or PRF secret).
  //   2. Derives the Cardano payment key at CIP-1852 / 1815' / account / 0 / 0.
  //   3. Signs the supplied Cardano tx CBOR with that key.
  //   4. Submits the signed tx to the Cardano network corresponding to the
  //      Midnight wallet's network (midnight-preview → cardano-preview, etc.).
  // Returns the tx hash. Used by `DustRegistrationDialog` for native registration.
  SIGN_AND_SUBMIT_DUST_REGISTRATION_TX = 'SIGN_AND_SUBMIT_DUST_REGISTRATION_TX',
  // Midnight: force a full re-sync from block 0. Clears both halves of the warm
  // state (gero-sync WS cursor + store snapshot, and the persisted SDK
  // wallet-state blobs) so a stuck/stale local view can be recovered without
  // reinstalling. User-triggered from the portfolio page's reset action;
  // delegates to `midnightSyncService.forceResync()` (BG-side, where the WS lives).
  RESYNC_MIDNIGHT = 'RESYNC_MIDNIGHT',
  // Insert a locally-known pending Midnight tx into the store immediately after
  // submit, so the send shows in history without waiting for gero-sync to index
  // and push it back. Deduplicated by hash: the confirmed entry from gero-sync
  // replaces it when it arrives.
  ADD_MIDNIGHT_PENDING_TX = 'ADD_MIDNIGHT_PENDING_TX',
  // DApp Connector: called by DAppOverlay.vue's Midnight signData branch
  // (side-panel bundle, after the user approves + authenticates) to actually
  // sign the dapp's data with the mandatory midnight_signed_message: prefix.
  // See walletBg.signMidnightConnectorData.
  SIGN_MIDNIGHT_CONNECTOR_DATA = 'SIGN_MIDNIGHT_CONNECTOR_DATA',
  // Sent by ChangePasswordDialog after a spending-password change. The DB
  // ciphertext is rotated, but the in-memory copies still hold the OLD blob:
  // the background WalletBg (used to sign) and walletStore.loggedWallet (used to
  // reveal the seed). The BG handler re-reads the fresh record and refreshes both
  // — WalletStore.setLoggedWallet broadcasts the new blob back to the options
  // store too — so the OLD password stops working immediately, no re-login.
  REFRESH_LOGGED_WALLET_SECRET = 'REFRESH_LOGGED_WALLET_SECRET',
}
