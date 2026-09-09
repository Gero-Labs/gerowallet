# Midnight Stagenet integration

Stagenet uses the isolated ledger 9 RC3 and wallet SDK beta.2 stack. Mainnet and
Preprod retain ledger 8. Deploy the matching Nexus and gero-sync changes before
testing this wallet build. Merged code, enabled writes, and confirmed on-chain
transactions are separate rollout milestones.

## Versions and endpoints

The partner draft in [Midnight docs PR 1162](https://github.com/midnightntwrk/midnight-docs/pull/1162)
at `442e02b962c73762045472193b88bc104a78a870` specifies the following stack.
The PR deliberately remains unmerged. Its checksum appendix lists older
proof-server and indexer versions; do not use those digests for these pins.

| Component | Stagenet version |
| --- | --- |
| Rust ledger | `9.1.0.0-rc.3` |
| JavaScript ledger | `@midnightntwrk/ledger-v9@1.0.0-rc.3` |
| Node | `2.0.0-rc.4` |
| Indexer | `4.4.0-rc.1` |
| Proof server | `9.0.0-rc.6` |
| Wallet SDK release family | `2.0.0-beta.2` |

Individual SDK packages have different major versions. Exact aliases in
`package.json` isolate them from legacy dependencies. Use Node 22.11 and normal
`npm ci`; do not resolve this graph with `--legacy-peer-deps`.

Public services are sufficient for wallet testing. You don't need your own node
or indexer deployment for every run.

| Service | Endpoint |
| --- | --- |
| RPC | `wss://rpc.stagenet.shielded.tools` (HTTPS supports JSON-RPC reads) |
| Indexer HTTP | `https://indexer.stagenet.shielded.tools/api/v4/graphql` |
| Indexer WebSocket | `wss://indexer.stagenet.shielded.tools/api/v4/graphql/ws` |
| Faucet UI | `https://faucet.stagenet.shielded.tools` |
| Faucet API supplied by Midnight | `https://faucet.stagenet.shielded.tools/api/drips` |
| Boot node for an optional self-hosted node | `boot.stagenet.shielded.tools` |

The wallet opens the faucet UI. Its current browser client posts
`recipientAddress` and `amount` to `/api/drips`, supplies `X-Captcha-Token`, and
polls `/api/drips/{dripId}`. Funding requires the faucet's CAPTCHA; the repeatable
suite does not bypass it or automatically request funds.

## Transfers and private balances

The wallet validates embedded networks and canonical signing payloads before
using keys. These paths are implemented for Stagenet.

| Capability | Behavior |
| --- | --- |
| Public NIGHT and custom-token sends | Nexus builds the public offer; the wallet balances DUST and signs the sender's inputs. |
| NIGHT registration for DUST | The wallet verifies the signing payload against the serialized ledger-9 transaction. |
| DUST sponsorship | An eligible wallet pays fees with its own DUST seed; the sender retains transfer signing authority. |
| Shielded custom-token sends | The local SDK synchronizes notes, constructs the transfer, and balances DUST. The token color is explicit. |
| Private balances and history | An unlocked local SDK session reconstructs notes and spent state. A viewing key alone is insufficient. |
| Cloud, local, and zkPaaS proving | Public and private sends honor the selected provider. Provider-specific consent covers DUST and private-note witnesses. |
| Long shielded addresses | The adapter checks Bech32m checksum, network, and 64-byte payload without the upstream 90-character limit. |

Native NIGHT is public. Merging an unshielded offer with a shielded offer does
not convert it: those offers have different asset types and do not balance.
Conversion requires an application contract, as explained in the
[Midnight FAQ](https://midnight.network/faq). The wallet explains this instead of
asking for credentials for an invalid conversion.

Private sync copies its seed into background memory and clears keys on lock,
logout, or wallet switch. It never persists the seed or sends it to Nexus or
gero-sync. Password unlock can start the session automatically. The private
balance control also accepts a spending password or PassKey ceremony. After a
background restart, authorize private sync again. Unknown private state is not
presented as an authoritative zero balance.

Local proving requires the matching native server. Stagenet setup displays:

```sh
docker run --rm -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.0-rc.6 midnight-proof-server -v
```

A health check establishes reachability, not circuit compatibility. zkPaaS
needs a ledger-9-compatible endpoint and credentials. A failed local or zkPaaS
check never silently changes the transaction to cloud proving.

Select the **Stagenet** local-server profile when using the RC6 server. The
profile controls both wallet sends and cross-device prover advertisement; it
does not follow the paired Cardano wallet's network. Cross-device proving keeps
the existing Cardano pairing and relay. The phone must support ledger-9
envelopes, request `9.0.0-rc.6`, and retain its transaction-content verification.
Native Midnight-only device pairing is outside this integration.

## Resets and saved state

The wallet verifies authenticated Nexus identity against indexer block zero.
Unknown identity fails closed without clearing data. Checkpoint namespaces
include ledger version, genesis hash, and generation. Preparation checks the
identity again before returning transactions, including after proving.

Nexus records a pending reset when it confirms a changed genesis while purge is
disabled. It preserves adopted identity and data, and refuses state writes until
reset recovery runs. gero-sync stamps updates with the captured generation,
retires old streams, and replays after an adopted change. The wallet ignores old
messages and clears only affected Midnight state before replay. Cardano data is
outside this reset path.

DUST snapshots require the exact SDK version, matching genesis and generation,
and a verified registration lower bound. A wallet restore date is not that
bound. Current Stagenet sends cold replay on a checkpoint miss instead of using
an unsafe guessed date. Fee failure or a stalled fee calculation discards a
restored empty checkpoint so a later attempt can recover.

## Verification and rollout

Run repeatable wallet checks without funded accounts:

```sh
npx vitest run src/chains/midnight src/services/midnight-tx.ledger.spec.ts src/services/__tests__/midnightTxPerToken.test.ts
```

Real SDK tests exercise signing, note spending, network validation, and binding.
Empty-envelope `prove()` tests establish API compatibility; they do not prove
that a funded DUST circuit succeeds. Synthetic fixture keys and nonexistent
UTxOs must never receive funds.

Build all extension entry points in an isolated checkout after `npm ci`:

```sh
node scripts/build-isolated-extension.mjs .
```

Use this deployment and test order:

1. Deploy [Nexus PR 997](https://github.com/Gero-Labs/nexus/pull/997), including
   V81, generation endpoints, pending-reset checks, and snapshot metadata.
2. Deploy [gero-sync PR 59](https://github.com/Gero-Labs/gero-sync/pull/59), then
   load the wallet build. Confirm stamped updates and cold resync.
3. Enable `STAGENET_WRITES_ENABLED` in the designated test environment with a
   matching proof server. Keep automatic purge off during initial testing.
4. Use dedicated Stagenet wallets for faucet funding, NIGHT registration, DUST
   charging, public transfers, sponsored fees, and confirmation/history.
5. Fund a genuine shielded custom-token fixture for receiving, private sync,
   spending, change, and lock/restart tests. NIGHT faucet funds alone cannot
   exercise private-token transfers.
6. Test local and zkPaaS circuit proofs and a ledger-8 Preprod regression.
   Exercise reset/purge only in disposable infrastructure.

Automatic purge remains a separate operational decision after every writer
uses generation checks. This development does not flip production flags.
[Wallet PR 1042](https://github.com/Gero-Labs/gerowallet/pull/1042) contains the
separate history-detail fix and must also land for its known loading and
response-normalization cases to pass.
