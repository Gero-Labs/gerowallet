# Bitcoin API — Not Yet Implemented

These methods are part of the Unisat-compatible API and/or Sats Connect (WBIP-004) but are not yet
implemented in GeroWallet. Each entry notes what backend work is required.

---

## Unisat API gaps (`window.unisat`)

### `switchNetwork(network: 'mainnet' | 'testnet'): Promise<void>`
Switches the active Bitcoin network.
**Requires:** A new `BITCOIN_METHOD.switchNetwork` background handler that updates the wallet's
active network in the store and persists it, plus a `btcSwitchNetwork` entry in `webpage.ts`.

### `switchChain(chain: string): Promise<void>`
Switches the active chain (e.g. Bitcoin mainnet → testnet, or to a supported L2).
**Requires:** Same infrastructure as `switchNetwork` plus defining the supported chain enum values.

### `sendBitcoin(toAddress: string, satoshis: number, options?: { feeRate?: number }): Promise<string>`
Constructs, signs, and broadcasts a simple Bitcoin payment.
**Requires:** PSBT construction in the background (`walletBg.ts`) using the wallet's UTXOs and
selected fee rate, then calling `signPsbt` + `broadcastTransaction` on `BitcoinApi`.
Returns the txid.

### `signData(data: string, type?: 'ecdsa' | 'bip322-simple'): Promise<string>`
Signs arbitrary hex data (not a human-readable message).
**Requires:** Extending the `BITCOIN_METHOD.signMessage` handler (or adding a new one) to accept
raw hex input in addition to UTF-8 strings.

### `multiSignMessage(messages: string[]): Promise<string[]>`
Signs multiple messages in a single user interaction.
**Requires:** New `BITCOIN_METHOD.signMessages` handler and a batch signing popup view.

### `verifyMessageOfBIP322Simple(address: string, message: string, signature: string): Promise<boolean>`
Verifies a BIP-322 simple signature without user interaction.
**Requires:** Pure crypto — no popup needed. Can be done in `webpage.ts` or `walletBg.ts` using a
BIP-322 verification library (e.g. `@scure/btc-signer` or `bitcoinjs-lib`).

### `getBalanceV2(): Promise<{ confirmed: number; unconfirmed: number; total: number; btcValue: string }>`
Enhanced balance format that also includes a human-readable BTC string.
**Requires:** Trivial wrapper around the existing `btcGetBalance` result.

### `getInscriptions(cursor?: number, size?: number): Promise<{ total: number; list: Inscription[] }>`
Returns the wallet's Ordinal inscriptions.
**Requires:** Integration with an Ordinals indexer API (e.g. Hiro Ordinals API or Unisat's own
indexer). No new signing infrastructure needed.

### `sendInscription(toAddress: string, inscriptionId: string, options?: { feeRate?: number }): Promise<string>`
Transfers an Ordinal inscription to another address.
**Requires:** UTXO selection logic that identifies the inscription UTXO (by outpoint), constructs a
transfer PSBT, and calls the existing sign + broadcast flow.

### `sendRunes(toAddress: string, runeid: string, amount: string, options?: { feeRate?: number }): Promise<string>`
Transfers Runes tokens.
**Requires:** Runes protocol encoding (OP_RETURN with Runestone), UTXO selection, and the
existing sign + broadcast flow.

### `inscribeTransfer(ticker: string, amount: number): Promise<string>`
Creates a BRC-20 transfer inscription.
**Requires:** Integration with a BRC-20 indexer and an inscription service (e.g. Unisat's
inscription API or a self-hosted `ord` instance).

---

## Sats Connect / WBIP-004 full support

`window.btc_providers` metadata is already registered (GeroWallet appears in wallet selector UIs),
but dapps that call the Sats Connect `request()` method won't work yet.

### `request(method, params): Promise<any>` — JSON-RPC provider
The Sats Connect protocol routes all calls through a single `request()` entry point on each
provider. Methods expected:

| Method                     | Description                                          |
|----------------------------|------------------------------------------------------|
| `getAddress`               | Return payment + ordinals addresses with public keys |
| `signTransaction`          | Sign a PSBT (equivalent to `signPsbt`)               |
| `signMessage`              | Sign a message                                       |
| `sendTransfer`             | Send BTC to an address                               |
| `signBatchPsbt`            | Sign multiple PSBTs                                  |
| `createInscription`        | Inscribe data on-chain                               |
| `createRepeatInscriptions` | Batch inscribe                                       |

**Requires:** Implementing a `request(method, params)` function on the provider entry in
`btc_providers`, routing each method to the corresponding existing or new background handler.
Reference: https://docs.xverse.app/sats-connect

---

## Unisat developer listing

To be listed as a compatible wallet on the Unisat developer portal:
- Open a PR / issue on https://github.com/unisat-wallet/unisat-dev-docs
- Or contact the Unisat team via their Discord / X (@unisatWallet)
