# Solana

Solana support, gated by the `isSolanaEnabled` feature flag (default off).

This folder is the chain core. Wallet create/restore, Gero Sync and the screens (balance, tokens, activity, receive, send) are wired in. The side panel shows no Solana view yet.

## Wiring

- **Wallet record** (`gero-db.ts`): `publicKey` is account #0's base58 address and the stored root key is the 64-byte BIP-39 seed, so added accounts (`softwareAccounts`, `addAccountKeys`) derive from it. Wallet identity compares addresses exactly (`walletIdentity.ts`).
- **Networks** (`utils/networks.ts`): Solana Mainnet (`comingSoon`) and Devnet, every feature off. `NetworkSelector` shows no Solana tile while `isSolanaEnabled` is off.
- **Gero Sync**:
  - `walletManager` subscribes `chain: 'SOLANA'` by the record's address, with the slot cursor from the wallet's `sync` table.
  - `websocket.service` sends the Solana SUBSCRIBE. On a catch-up it keeps the cursor at the newest delivered slot, and carries the `solana_*` snapshot through.
  - `sync.service.applySolanaSync` merges into `walletStore.solanaTransactions` (IndexedDB bulk field) and `walletStore.solana` (balance, tokens, tip slot), and persists the cursor.
  - `FORCE_RESYNC` clears both and re-subscribes at 0.
- **Screens**: `PortfolioPage` renders `SolanaDashboard.vue` (balance, SPL tokens by mint, the latest 25 transactions with Solscan links). Receive is the shared `ReceiveDialog` (one address, its path). Send is `SolanaSendDialog.vue`, opened from the quick actions.
- **Send** (`chrome/solanaSend.ts`, extension pages only):
  - `SOLANA_SEND_QUOTE` gives the fee at two levels: Standard (median priority price) and Fast (p75), from Nexus `/api/sol/fees`, capped at `MAX_PRIORITY_MICRO_LAMPORTS`.
  - `SEND_SOLANA` takes only the recipient, lamports and fee level. The worker reads the sender, balance and price itself and applies `checkSolTransfer` (`solanaSendRules.ts`, the same rules the dialog shows): a valid address that is not the wallet's own, a known balance, the fee counted, no leftover below the rent-exempt minimum, and no new recipient account opened below it.
  - It then takes a recent blockhash from Nexus `chain/tip`, signs in `WalletBg.signSolanaTransfer` (phrase → key at the record's account, refused unless it gives the record's address, wiped after) and submits through Nexus.
  - Pages see an error code only (`solanaSendErrorKey`), never server text. `SUBMIT_FAILED` tells the user to check their activity before retrying, because the transaction may have landed.
- **dApp connection** (behind `isSolanaEnabled`; the worker reads it from the flag mirror):
  - `chrome/injectSolana.ts` registers Gero as a Wallet Standard wallet (never `window.solana`) once `SOLANA_METHOD.available` says the flag is on: `standard:connect` / `disconnect` / `events`, `solana:signMessage`, `solana:signTransaction` and `solana:signAndSendTransaction`.
  - `SOLANA_METHOD.connect` answers a connected site with the account at once, never prompts a `silent` call, and otherwise parks a side-panel prompt (with the account picker) as Midnight's connect does. Connections are the account's own `connected_dapps` rows.
  - `SOLANA_METHOD.signMessage` is for a connected site and the connected account only. `solanaSignMessage.ts` refuses empty, oversized and transaction-shaped bytes (a signature over a transaction message signs that transaction) in the handler, in the panel's `SIGN_SOLANA_MESSAGE` and in `WalletBg.signSolanaMessage`. The worker checks the panel's signature against the account's key and the exact bytes before the dApp gets it.
  - **Transactions** (`SOLANA_METHOD.signTransaction` / `signAndSendTransaction`, one handler, `chrome/solanaDappTx.ts`): a connected site and account only, on the wallet's chain. The worker decodes the bytes itself (`solanaTxWire.ts`: legacy and v0, strict), refuses one the account does not sign, resolves lookup tables through Nexus `POST /api/sol/accounts`, reads the instructions (`solanaTxInstructions.ts`: transfers, fee, and what hands over control: Assign, SetAuthority, Approve, CloseAccount to someone else, nonce authority, durable nonce) and simulates through Nexus `POST /api/sol/txs/simulate` with the wallet and every writable account (at most 32). `solanaTxPreview.ts` compares those accounts before and after: the wallet's SOL and token changes, and a token account or the wallet changing owner or gaining a delegate inside a program (CPI). The side panel shows it; a critical warning must be acknowledged before signing.
  - The transaction is signed exactly as the dApp sent it: no blockhash, fee or instruction is swapped in. Preparing grants a one-shot allowance for that message (`chrome/solanaTxAllowance.ts`, 10 min); the panel's `SIGN_SOLANA_TRANSACTION` consumes it before any secret is opened, and `WalletBg.signSolanaDappTransaction` signs nothing else. The worker accepts the panel's result only if nothing but the wallet's signature slot changed and that signature verifies (`isSignedByWalletOnly`). `signAndSend` then submits through Nexus with preflight.
  - Errors reach the page as Errors with Phantom's codes (`solanaDappProtocol.ts`: 4001 declined, 4100 not connected, 4200 unsupported).
- Imports of this folder from code in the background bundle are static, never `await import()`: an inlined dynamic-import namespace can be read before it is declared (`scripts/check-bundle-tdz.mjs`).

| File | What it does |
|---|---|
| `solanaPaths.ts` | `m/44'/501'/n'/0'`, the path Phantom, Solflare and Ledger Live use, so a restored phrase shows the same addresses. No dependencies, so hardware modules can import it. |
| `solanaKeyManager.ts` | SLIP-0010 ed25519 derivation from a BIP-39 phrase, address validation (`isValidSolanaAddress` accepts off-curve program addresses; `isOnCurveSolanaAddress` tells keys apart from them). Built on `@noble` only, so it runs in the background worker. |
| `solanaBase58.ts` | Base58 for addresses, blockhashes and signatures. |
| `solanaAmount.ts` | Lamports and SPL raw units as `bigint` (a u64 can exceed `Number.MAX_SAFE_INTEGER`); `formatSol`/`parseSol`. |
| `solanaTransaction.ts` | Native SOL transfer: hand-encoded legacy message (SystemProgram transfer, optional ComputeBudget limit and price), ed25519 signing, fee estimate. |
| `solanaSendRules.ts` | The rules a SOL send must pass, fee levels, Max, and the page text for each error code. Shared by the dialog and the worker. |
| `solanaExplorer.ts` | Solscan links, only for a well-formed signature or address. |
| `solanaSignMessage.ts` | What a dApp may have signed as a message: refuses transaction-shaped bytes; text or hex for the prompt. |
| `solanaTxWire.ts` | Wire-format transactions (legacy, v0): strict decode, lookup-table resolution, signature slot fill. |
| `solanaTxInstructions.ts` | Reads System, Compute Budget, Token / Token-2022, Associated Token and Memo instructions; fee; static warnings. |
| `solanaNexusAccounts.ts` | Nexus account and simulation rows, read strictly (exact lamports, order checked); token accounts, lookup tables. |
| `solanaTxPreview.ts` / `solanaTxPreviewView.ts` | The preview from before/after accounts; its rows and warning keys for the side panel. |
| `solanaDappProtocol.ts` | dApp error codes and shapes, Wallet Standard chain ids, byte-array checks. No dependencies (page bundle). |
| `solanaWireSync.ts` | Gero Sync `SOLANA` messages → transactions, balance, tokens, cursor. Contract: gero-sync `docs/solana-wire.md`. |

`src/api/solana-api.ts` is the Nexus `/api/sol` client. It calls Nexus directly with the device JWT, as the Midnight client does; device tokens carry `SOLANA_READ`/`SOLANA_WRITE`. Realtime updates come from Gero Sync, and this client covers on-demand reads, fees and submit.

## Rules

- Never persist or log a `secretKey`. Derive it from the phrase when signing, then wipe it.
- An unknown balance is `undefined`, never `0`. Gero Sync omits a field when Nexus failed.
- The Gero Sync cursor (`lastSyncedBlock`) is a slot. Only a `SYNC` that delivered transactions moves it; the `block` on `CATCH_UP_COMPLETE` / `SYNC_CHECK_OK` is the tip, for display.
- Networks are `Mainnet` and `Devnet` (Nexus `solana-mainnet` / `solana-devnet`). Gero Sync and Nexus serve no others.

## Tests

`npx vitest run src/chains/solana` runs the unit tests. The key derivation is pinned to `solana-keygen` output.

`solanaTransaction.localnet.spec.ts` submits real transfers to a validator and checks the fee and balances. It is skipped unless you point it at one:

```bash
solana-test-validator --reset
VITE_SOLANA_LOCALNET_RPC=http://127.0.0.1:8899 npx vitest run src/chains/solana/solanaTransaction.localnet.spec.ts
```
