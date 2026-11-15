# Midnight connector test dApp

A single page that calls every method of a Midnight wallet's DApp Connector
(`@midnightntwrk/dapp-connector-api` 4.1) the way a dApp does, on ledger 9.
Each call is timed and logged with its result. For a rejection, the log checks
the error against the spec's `APIError`: an `Error` with
`type: 'DAppConnectorAPIError'`, a known `code` and a `reason`.

It works with any wallet that installs itself under `window.midnight`, not
only Gero, so it also shows how another wallet answers the same calls.

## Run it

```bash
npm run midnight:connector-dapp
```

Open http://localhost:3341 in a Chrome that has the wallet installed and
unlocked. Content scripts do not run on `file://`, so use the server. The
wallet remembers site approvals per origin; keep to `localhost:3341`.

`npm run midnight:connector-dapp:build` writes a static copy to
`dist/midnight-connector-dapp/` for hosting it somewhere else.

## Steps

| Step | Calls | What to look for |
|---|---|---|
| 1 Wallets | `window.midnight` discovery | Every wallet, its `rdns`, `apiVersion` and key. Gero's key is a random UUID, as the spec requires, so dApps that hard-code `mnLace` or `"1am"` never see it. |
| 2 Connect | `connect`, `getConnectionStatus`, `getConfiguration`, `hintUsage` | The reported `networkId` matches the one asked for; `indexerUri` is the wallet's indexer. |
| 3 Read | the address and balance getters, `getTxHistory` | Balances are keyed by token colour; NIGHT and USDM are named. |
| 4 Sign data | `signData` | Checked in the page: the signed bytes are `midnight_signed_message:<len>:` plus the payload, and the BIP-340 signature verifies against the returned key. |
| 5 Transfer | `makeTransfer`, `submitTransaction` | The wallet builds, fee-pays, proves and seals the transfer; the page decodes it. |
| 6 Swap intent | `makeIntent` | A sealed, purposely imbalanced intent. It is decoded, not submitted: it needs a counterparty. |
| 7 dApp-built transaction | `getProvingProvider`, `balanceUnsealedTransaction`, `submitTransaction` | The page builds a ledger 9 transaction that pays an output and spends nothing, proves it with the wallet's provider, and the wallet funds, fee-pays, signs and seals it. This is the path contract dApps use. |
| 8 Sealed transaction | `balanceSealedTransaction` | Paste another wallet's step 6 intent to fill it. |
| 9 Proving provider | `getProvingProvider`, `provider.check` | A wallet that cannot prove should fail quickly. Calls over 60 s are marked, the limit some dApps enforce. |
| 10 Decode or submit | `submitTransaction` | Decodes any ledger 9 transaction (sealed, unbound or unproven) and submits it. |

Amounts for NIGHT and USDM take decimals (6 places); a custom token's amount
is in raw units. Recipients default to the connected wallet's own address.

## What it needs

- A funded wallet on the network you connect to: NIGHT, and DUST for fees.
- Proving: Gero proves `makeTransfer` and the fee of a balanced transaction
  with the user's chosen prover (the device, a local proof server, or a
  zkPaaS). With Gero Cloud selected, a dApp's own proofs need a local proof
  server or a zkPaaS; the wallet says so.
- The wallet's indexer must be at the chain tip. If the wallet shows
  "Paused", balances and history are behind and builds can fail.

## Files

- `index.html`, `style.css`: the page.
- `main.ts`: discovery, the call log and every step.
- `ledger.ts`: what the page does with `@midnightntwrk/ledger-v9`: the
  address codec, the dApp-built transaction, the decoder and the `signData`
  check. Nothing in it talks to the wallet.
- `vite.config.mts`: serves the page; `vite-plugin-wasm` loads ledger 9.
- `tsconfig.json`: `npx tsc -p test/midnight-connector-dapp` typechecks the
  page, which the root `typecheck` (`src/` only) does not cover.

## Other dApps to test against

These exercise the connector from someone else's code. Check each still runs
on the network's current ledger before relying on it.

- Lunardraw (https://lunardraw.io), preprod: contract calls with proving,
  `balanceUnsealedTransaction`, the DUST and unshielded getters.
- Dominion (https://dominion-preprod.1am.xyz), 1AM's poker dApp, preprod:
  `getProvingProvider`, `balanceUnsealedTransaction`, `submitTransaction`. It
  gives up on a wallet call after 60 s.
- DareU (https://dareu-preprod.vercel.app), preprod: `signData` login,
  shielded balances, a proven deposit.
