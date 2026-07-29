/**
 * Midnight Chain — Type Definitions
 *
 * Core types for Midnight Network state, ported from the prototype on
 * `new-midnight-backup` branch with corrections from production wallets:
 *
 * - **NIGHT decimals: 6** (per the Midnight reference implementation).
 *   The prototype used 12 decimals; that's wrong.
 * - **DUST decimals: 15** (per the Midnight reference implementation).
 * - **Dust generation status enum** and time-remaining tracking added beyond the prototype's
 *   shape, matching what the indexer and the Midnight reference implementation use.
 *
 * Three address types (shielded / unshielded / dust), each derived from a different
 * HD role: Zswap (3), NightExternal (0), Dust (2). (Role 4 is Metadata in wallet-sdk-hd 3.x.) Path: `m/44'/2400'/account'/role/index`.
 */

/**
 * Decimal places for Midnight's two tokens. NIGHT amount-in-base-units / 10^6 = NIGHT.
 * DUST amount-in-base-units / 10^15 = DUST.
 */
export const MIDNIGHT_DECIMALS = {
  NIGHT: 6,
  DUST: 15,
} as const;

/**
 * Midnight balance components for a single wallet account.
 *
 * NIGHT is the public, transferable token; DUST is the non-transferable,
 * time-decaying fee resource generated from registered NIGHT UTXOs.
 *
 * Shielded NIGHT is private — the indexer cannot see it. The SDK computes
 * shielded balance locally from the wallet's note tracking.
 */
export interface MidnightBalances {
  /** NIGHT in shielded pool (private, computed locally by the SDK from notes). */
  nightShielded: bigint;
  /** NIGHT in unshielded pool (public, summed from `unshieldedTransactions` events). */
  nightUnshielded: bigint;
  /** NIGHT registered against the DUST mapping validator (generates DUST while held). */
  nightRegistered: bigint;
  /** DUST currently available to spend on fees (cannot be transferred). */
  dust: bigint;
  /** Projected DUST per-second/day generation rate from `nightRegistered`. */
  dustGenerating: bigint;
}

/**
 * The three address types a Midnight wallet exposes. Each derives from a different
 * HD role under `m/44'/2400'/account'/role/index`.
 */
export interface MidnightAddresses {
  /** Dust address (`mn_dust-addr_*`). Recipient for DUST registration mappings. */
  dust: string;
  /** Shielded address (`mn_shield-addr_*`). Receives Zswap private payments. */
  shielded: string;
  /** Unshielded address (`mn_addr_*`). Receives public NIGHT transfers. */
  unshielded: string;
  /**
   * Raw signing public key hex — returned by `UnshieldedKeystore.getPublicKey()`.
   * Required by the Nexus sidecar to reconstruct the wallet seedlessly via
   * `UnshieldedWallet.startWithPublicKey({ publicKey, addressHex, address })`.
   * Stored in the wallet DB at creation/restore time; derived lazily on first send
   * for wallets created before this field was added.
   */
  publicKeyHex?: string;
  /**
   * Address bytes as hex — returned by `UnshieldedKeystore.getAddress()`.
   * Same lifecycle as `publicKeyHex` above.
   */
  addressHex?: string;
  /**
   * Bech32m-encoded Zswap encryption SECRET key — what the Midnight indexer
   * calls the "viewing key" in its `connect(viewingKey)` mutation. Wire form
   * has HRP `shield-esk` (`mn_shield-esk_<network>1…` non-mainnet, bare
   * `mn_shield-esk…` mainnet). The indexer needs the secret to decrypt
   * incoming shielded notes server-side — same shape as Zcash's IVK.
   *
   * BLAST RADIUS: anyone with this string can decrypt every incoming
   * shielded note for this wallet, forever. Cannot spend, but can fully
   * de-anonymize. Followup work: move to encrypted-at-rest storage
   * alongside the mnemonic instead of plain-form on the publicKey JSON.
   *
   * Optional for backward compat: wallets created before this field was added
   * keep doing unshielded-only sync. Re-derived + persisted on first wallet
   * upgrade or on a forced re-derivation path.
   */
  zswapViewingKey?: string;
  /**
   * Cardano CIP-1852 account 0 xpub (bech32 `xpub1...`) derived from the same
   * mnemonic. Lets a Midnight wallet natively sign the Cardano-side DUST
   * registration tx without requiring a separate Cardano wallet. Mirrors
   * the reference implementation's pattern of one mnemonic feeding all per-chain integrations.
   * Optional for backward compat — wallets created before this field was added
   * get it derived + persisted on first DUST registration attempt.
   */
  cardanoXpub?: string;
  /** Cardano base address at external chain index 0 (`addr1...`/`addr_test1...`). */
  cardanoBaseAddress?: string;
  /** Cardano stake/reward address (`stake1...`/`stake_test1...`). */
  cardanoStakeAddress?: string;
  /** 28-byte hex payment-key hash for the Cardano base address. */
  cardanoPaymentKeyHashHex?: string;
}

/**
 * DUST registration status against the Cardano-side mapping validator.
 *
 * Registration creates a UTxO at the validator with `(CardanoCredential, DustAddress)`
 * datum; the bridge/observability layer relays the mapping to Midnight after
 * ~432 Midnight blocks (~2.5h).
 */
export type DustRegistrationStatus =
  | 'Unregistered'   // No mapping observed for this Cardano wallet
  | 'Pending'        // Mapping UTxO exists on Cardano; relay in progress
  | 'Registered'     // Mapping accepted by the Midnight node; DUST generation active
  | 'Invalid';       // Mapping exists but rejected (malformed datum, conflict, etc.)

/**
 * State of the dust "tank" — the visual primitive used to show generation status.
 * Driven by the relationship between current dust balance, max cap, and time.
 */
export type DustGenerationStatus =
  | 'empty'      // No DUST, no NIGHT registered
  | 'refilling'  // Below cap, generation rate > decay
  | 'filled'     // At cap; generation paused, decay yet to begin
  | 'decaying';  // Above cap (after registration removed) or grace period elapsed

/**
 * Categorisation of Midnight transactions as shown in the wallet's history list.
 * Combines normal send/receive with Midnight-specific actions (DUST register/dereg,
 * shield/unshield NIGHT, contract calls).
 */
export type MidnightTransactionType =
  | 'send'
  | 'receive'
  | 'register_dust'
  | 'deregister_dust'
  | 'shield'         // Move public NIGHT into the shielded pool
  | 'unshield'       // Move shielded NIGHT into the public pool
  | 'contract_call'; // Compact contract invocation (Midnight-specific)

/**
 * One Midnight transaction record for the wallet's history view.
 */
export interface MidnightTransaction {
  /** Indexer transaction hash (32-byte hex). */
  hash: string;
  /** High-level UI category. */
  type: MidnightTransactionType;
  /** Which token moved. */
  token: 'NIGHT' | 'DUST';
  /** Token amount (base units; divide by `MIDNIGHT_DECIMALS[token]`). */
  amount: bigint;
  /** Counterparty address (sender or recipient depending on `type`). */
  counterparty: string;
  /** Block timestamp from indexer. */
  timestamp: number;
  /** Settlement status. */
  status: 'confirmed' | 'pending' | 'failed';
  /** DUST burned for fees (always in DUST base units). */
  fee: bigint;
  /** Block height (Substrate). */
  blockHeight?: number;
  /** Whether the tx used a shielded/Zswap path. */
  isShielded: boolean;
  /** Time spent generating ZK proofs, in milliseconds (only for shielded txs). */
  proofTimeMs?: number;
  /** Serialized substrate tx hex (the `raw` field from indexer's Transaction type). */
  raw?: string;
}

/**
 * Unshielded UTXO shape — matches the indexer's `UnshieldedUtxo` GraphQL type
 * (verified live 2026-05-03 against indexer-standalone:4.0.1).
 */
export interface MidnightUnshieldedUtxo {
  /** Owner unshielded address. */
  owner: string;
  /** Token type ID (32-byte hex; native NIGHT vs custom shielded/unshielded tokens). */
  tokenType: string;
  /** Token amount (base units). */
  value: bigint;
  /** Hash of the transaction's intent, not the outer tx hash. */
  intentHash: string;
  /** Position within the tx's outputs. */
  outputIndex: number;
  /** Creation timestamp (nullable). */
  ctime?: number;
  /** ZK nonce. */
  initialNonce: string;
  /**
   * Whether this NIGHT UTXO is registered against the DUST mapping validator
   * and actively generating DUST. Drives the per-UTXO state in the dust tank UI.
   */
  registeredForDustGeneration: boolean;
}

/**
 * Live state for the dust-tank UI primitive. Computed by the wallet from
 * accumulated subscription state + Nexus's `/dust/status` endpoint.
 */
export interface MidnightDustState {
  status: DustGenerationStatus;
  /** Current DUST balance (base units). */
  current: bigint;
  /** Maximum DUST possible at current `nightRegistered` (base units). */
  cap: bigint;
  /** Generation rate per second (base units/sec). */
  generationRate: bigint;
  /** Estimated seconds until cap is reached (or seconds until empty if decaying). */
  timeRemainingSeconds: number | null;
  /** Whether mapping validator registration is active. */
  registrationStatus: DustRegistrationStatus;
}
