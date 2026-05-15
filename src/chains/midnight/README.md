# Midnight Chain Module

This package mirrors `src/chains/bitcoin/` for Midnight Network — the chain skeleton + adapter the rest of the wallet dispatches to when `chain === Blockchain.MIDNIGHT`.

## Status: scaffolding (PR1)

**Currently lands:**
- Type definitions (`midnightTypes.ts`) — `MidnightBalances`, `MidnightAddresses`, `MidnightTransaction`, `MidnightUnshieldedUtxo`, `MidnightDustState`, `DustRegistrationStatus`, `DustGenerationStatus`, etc.
- Network endpoint config (`midnightConfig.ts`) — Nexus base, Gero-Sync WS, public Foundation fallbacks per network, helper for composing Nexus per-network paths
- Chain adapter skeleton (`midnightAdapter.ts`) — implements `IChainAdapter` with stubs for SDK-dependent methods (key derivation, address handling) and real implementations for chain-agnostic concerns (encryption)

**Not yet landed (follow-up PRs):**
- `@midnight-ntwrk/wallet-sdk-*` package integration (key derivation, address derivation, address validation, transaction building, ZK proof orchestration)
- `midnightStore.ts` — Vue Observable store (port from `new-midnight-backup` branch, decouple from mock-data)
- Send / receive / DUST tank UI components
- Onboarding integration (Midnight as a selectable chain in `CreateWallet.vue`)
- Wallet ↔ Gero-Sync WebSocket subscription path
- Wallet ↔ Nexus REST calls (DUST status, contract state, tx submission)
- DApp connector at `window.midnight.gero` (CIP-30-equivalent for Midnight)

## Architectural notes

### NIGHT vs DUST

Both the **public payment token** (NIGHT, 6 decimals) and the **non-transferable fee resource** (DUST, 15 decimals) coexist. DUST is generated from registered NIGHT UTXOs and decays toward a cap. The wallet displays DUST as the chain's "native" token (matching Lace's `nativeTokenInfo` decision) — NIGHT is treated as a designated unshielded token that also drives DUST generation.

### Three address types

Each Midnight account derives three independent addresses from different HD roles under `m/44'/2400'/account'/role/index`:

| Address | Role | HRP |
|---|---|---|
| Unshielded | `Roles.NightExternal` (0) | `mn_addr_*` |
| Shielded | `Roles.Zswap` (3) | `mn_shield-addr_*` |
| Dust | `Roles.Dust` (4) | `mn_dust-addr_*` |

The receive UI shows all three with copy + QR per type (matching Lace's pattern).

### Coin type 2400

`CoinTypes.MIDNIGHT = HARDENED + 2400` is added to `src/models/types.ts`. This is the BIP44 coin type Midnight uses — note it is **not yet on the canonical SLIP-0044 list**, which is one reason hardware wallet (Ledger/Trezor/Keystone) support for Midnight is not feasible today.

### No hardware wallet support

Midnight ZK proof generation requires the secret key in cleartext. Hardware wallets cannot expose private keys, so they cannot participate in proof generation. `NetworkInfo.supportedHardware: false` for all three Midnight networks. Lace ships in-memory only too — this is consistent across the ecosystem.

### Why some `IChainAdapter` methods are no-ops

Midnight's wallet flow is **subscription-driven**, not pull-based: the SDK's `WalletFacade` manages its own state via the indexer's GraphQL WebSocket. The `IChainAdapter` UTxO/coin-selection contract is shaped for the pull-based Bitcoin/Cardano model and doesn't fit Midnight cleanly. We expose what IS chain-agnostic (encryption, identity) and route everything else through Midnight-specific services that don't pretend to be Bitcoin-shaped.

This is a deliberate architectural choice. Trying to coerce Midnight into the Bitcoin-shaped contract creates impedance mismatches that hide bugs (the wrong UTxO shape, wrong coin-selection assumptions, irrelevant fee-rate parameter, etc.). The PR1 adapter is honest about what isn't implemented (`MidnightSdkNotIntegratedError`) so future implementers don't accidentally call it before the SDK is wired.

## Pinned SDK target versions (when integration lands)

Latest published on NPM as of 2026-05-04 — see master gap analysis for the full list:

```json
{
  "@midnight-ntwrk/wallet-sdk-facade": "4.0.0",
  "@midnight-ntwrk/ledger-v8": "8.0.3",
  "@midnight-ntwrk/dapp-connector-api": "4.0.1",
  "@midnight-ntwrk/wallet-sdk-hd": "3.0.2",
  "@midnight-ntwrk/wallet-sdk-shielded": "3.0.0",
  "@midnight-ntwrk/wallet-sdk-unshielded-wallet": "3.0.0",
  "@midnight-ntwrk/wallet-sdk-dust-wallet": "4.0.0",
  "@midnight-ntwrk/wallet-sdk-address-format": "3.1.1"
}
```

`ledger-v8` is the WASM-heavy package — bundle-size and Manifest V3 service-worker compatibility need to be validated before committing to in-extension SDK integration vs server-side proxying.

## See also

- Master gap analysis: `docs/superpowers/specs/2026-05-03-midnight-integration-gap-analysis.md`
- Nexus handoff: `D:\GeroRepos\gitRepos\nexus\docs\superpowers\plans\2026-05-03-midnight-integration.md`
- Gero-Sync handoff: `D:\GeroRepos\gitRepos\gero-sync\docs\plans\2026-05-03-midnight-integration.md`
