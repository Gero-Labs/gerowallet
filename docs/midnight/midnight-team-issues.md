# Midnight integration: issues to raise with the Midnight team

Date: 2026-07-02
Author: Gero Wallet team
Context: Gero Wallet is a Cardano-first browser extension adding native Midnight
support (NIGHT public transfers, shielded NIGHT, and Cardano-side DUST
registration). We build and sign Midnight transactions in an MV3 service
worker, sync via the public indexer, and relay submission through our own
backend (Nexus). This is the list of concrete blockers and developer-experience
issues we hit, with the exact place each one bites us so they are actionable.

Everything below is grounded in behavior we reproduced against preprod and, where
noted, verified against the SDK / indexer source. Items we are not certain about
are phrased as questions rather than assertions.

---

## 1. No "UTxO by address" query on the indexer (highest priority)

Symptom: the indexer is push / subscription only. There is no request that
answers "give me the current unshielded UTxOs owned by address X". A fresh
consumer can only subscribe and replay events forward from a cursor.

Why it blocks us: every party that needs a balance or a spendable UTxO set for a
given address has to independently maintain its own address to UTxO index by
consuming the full event stream. In our stack that means our sync service
(gero-sync) rebuilds this index, and our backend (Nexus) keeps a second copy in
Postgres, purely because neither can ask the indexer directly. A cold consumer
must walk from genesis before it can build a single transaction.

Ask:
- Is an "UTxOs for address" (and "balance for address") query on the roadmap?
- If not, is there a supported pattern for a stateless client to obtain a
  spendable set without maintaining its own full projection of the chain?

## 2. "Viewing key" is actually the encryption SECRET key, and a wrong input fails silently

What we found (verified against the indexer `viewing_key` source and the
`ShieldedEncryptionSecretKey` codec): the value the indexer `connect()` call
expects as the "viewing key" is the Zswap encryption SECRET key, bech32m encoded
with HRP `mn_shield-esk_<network>`. It is decoded as a `ledger::SecretKey`.

Two problems:
- Naming. "Viewing key" strongly implies a read-only / public capability. It is
  in fact the secret decryption key. We initially derived and sent the public
  key (`mn_shield-epk_`) and then a raw hex value, both of which are wrong. The
  correct derivation in our code is now
  `ShieldedEncryptionSecretKey.codec.encode(networkId, esk)` producing
  `mn_shield-esk_...` (see `src/chains/midnight/midnightKeyManager.ts`).
- Silent failure. Supplying the wrong key material (wrong HRP, or a public key,
  or raw hex) does not produce a clear "this is not a secret key / wrong HRP"
  rejection at connect time. The failure surfaces later as "no data" rather than
  as a validation error, which cost us significant debugging time.

Ask:
- Can the docs state explicitly that the indexer viewing key is the encryption
  secret key with HRP `mn_shield-esk`, ideally with a worked derivation example?
- Can `connect()` reject a malformed / wrong-HRP / public-key input at call time
  with a descriptive error instead of degrading to an empty result?

## 3. `waitForSyncedState()` never resolves on an empty global ledger

Symptom: `wallet.waitForSyncedState()` can hang indefinitely. We traced it to
sync progress only being reported (and `isConnected` only flipping) when a state
update actually arrives. On a network whose global DUST ledger has produced no
events yet, no update ever arrives, so the promise never settles. We confirmed
this reproduces across the SDK versions we tested (it is not fixed by moving to
the 4.x dust wallet), and that preprod works only because its global ledger
already has events.

How we work around it: we wrap the call in a bounded
`Promise.race([wallet.waitForSyncedState(), timeout])` and treat the timeout as
"synced enough to proceed" (see `src/chains/midnight/midnightTxBuilder.ts`
around the dust builder, and the shielded builder). This is a workaround, not a
fix, and it makes cold sync on a quiet network look like a hang to the user.

Ask:
- Is this the intended behavior? If so, can it be documented, with a supported
  way to distinguish "connected, ledger genuinely empty" from "not yet
  connected"?
- Could `waitForSyncedState()` resolve once the wallet is connected and caught
  up to the current tip, even when zero updates were delivered?

## 4. Confirm the supported ledger / node / SDK version matrix

We currently pin a mix of package versions (dust wallet, shielded, unshielded,
and a `ledger-v8` that still uses the older dashed `@midnight-ntwrk` scope while
the newer packages use the canonical `@midnightntwrk` scope). We are not certain
which combination is the supported one for preprod today and for mainnet at
launch.

Ask:
- What is the supported / tested version matrix (dust wallet, shielded wallet,
  unshielded wallet, ledger) for preprod now and for mainnet?
- Is `ledger-9` / Node 2.0 the target for mainnet, and by when?
- Is the dashed `@midnight-ntwrk` scope a frozen alias that will keep working,
  or should we migrate everything to `@midnightntwrk`?

## 5. Package scope split (`@midnight-ntwrk` vs `@midnightntwrk`)

Minor but real friction: some packages publish under `@midnight-ntwrk` (dashed)
and others under `@midnightntwrk` (canonical). This makes it easy to install two
copies of what looks like the same dependency and to get subtle type mismatches
between them. A clear statement of which scope is canonical and which is a
compatibility alias (and a deprecation timeline for the alias) would help.

---

## What we have already solved on our side (for context, not asks)

These are noted so the team knows what we are NOT blocked on:
- Cold-sync-per-send: we persist `serializeState()` and `restore()` on the next
  send, so each send resumes from its saved cursor instead of replaying.
- DUST registration on preprod works end to end (Cardano-side registration ->
  indexer -> our sync -> our backend UTxO table -> spendable).
- Three-address model (unshielded `mn_addr_`, shielded `mn_shield-addr_`, dust
  `mn_dust_`) and HD derivation `m/44'/2400'/account'/role/index` are wired.

## Open question we are still resolving internally (may become an ask)

- Cross-pool value movement (shielded <-> unshielded) appears to require an
  explicit swap / balance operation rather than a direct transfer. If there is a
  canonical "shield" / "unshield" primitive we should be calling, a pointer to
  it would save us time. We will confirm on our side first before raising this
  formally.
