# Shielded NIGHT send — e2e runbook

**Status:** Active runbook, run once after the wallet stack lands on `midnight-preview`.
**Pairs with:** [PR #681](https://github.com/Gero-Labs/gerowallet/pull/681) → [PR #682](https://github.com/Gero-Labs/gerowallet/pull/682) → [PR #683](https://github.com/Gero-Labs/gerowallet/pull/683).
**Backend dependencies:** gero-sync `dev-v0.1.32` and nexus `v1.0.121-8f40d38`, both manually deployed 2026-06-07/08 to the `gero` GKE cluster.

## What this runbook proves

A user can complete a shielded NIGHT transfer from a fresh wallet end to end:

1. A wallet created on this stack persists a Zswap viewing key on its record.
2. Login passes the viewing key to gero-sync; the indexer opens a shielded session.
3. The Send dialog renders the Unshielded ↔ Shielded tab and gates the shielded path behind the consent dialog.
4. The BG builds + signs a shielded tx; nexus's `/tx/prove-and-submit` proves and submits.
5. The resulting tx is observable on the Midnight preview chain.

Each phase is independent — if one fails, the next still tells you something useful. Don't skip the diagnostic capture; the failure surface is large and "tried to send, got an error" doesn't narrow it down.

## Prerequisites

- [ ] PR stack #681 → #682 → #683 merged into `midnight-preview`. Check with `git log --oneline midnight-preview -5`.
- [ ] Local `git checkout midnight-preview && git pull` to that head.
- [ ] gero-sync verified at v0.1.32 in the dev cluster:
  ```bash
  kubectl get deploy gero-sync -n gero -o jsonpath='{.spec.template.spec.containers[*].image}'
  # expect: registry.gerowallet.io/gero/gero-sync:gero-sync-dev-v0.1.32
  ```
- [ ] nexus verified at v1.0.121-8f40d38 in the dev cluster:
  ```bash
  kubectl get deploy nexus -n gero -o jsonpath='{.spec.template.spec.containers[*].image}'
  # expect: registry.gerowallet.io/gero/nexus:nexus-v1.0.121-8f40d38
  ```
- [ ] SigNoz access (you'll use it to verify the indexer subscription opens).
- [ ] A funded test wallet, OR a fresh wallet you'll fund via the Midnight preview faucet before the shielded-send phase. Faucet: search "Midnight preview faucet" on the Foundation discord; address must be `mn_addr_preview_…` for unshielded NIGHT or `mn_shield-addr_preview_…` for shielded NIGHT.

## Phase 1 — Build + sanity check

- [ ] `npm install && npm run dev` from the gerowallet root.
- [ ] Load `dist/` as an unpacked extension in Chrome.
- [ ] Confirm the existing unshielded NIGHT flow still works on an existing wallet (regression check — the marker fix b68d0f29 outcome is still open from earlier; if this is broken, **stop here** and capture the BG console error before touching shielded).

**Pass:** existing unshielded send produces a tx hash and the dashboard shows the deduction.

**Fail:** capture the BG service-worker console (`chrome://extensions` → Inspect service worker) plus the network tab for the `/tx/finalize` request. **STOP** and report — shielded depends on the same auth + key-derivation path.

## Phase 2 — Fresh wallet creates a viewing key

- [ ] Create a brand-new Midnight preview wallet (password OR PRF — doesn't matter, both paths derive identically).
- [ ] Open the BG service-worker console.
- [ ] Inspect the wallet record's `publicKey` JSON:
  ```js
  // In BG console:
  const db = await indexedDB.databases();
  // Look for `gero-wallet` DB, then `wallets` store. Open the wallet row and inspect `publicKey`.
  // Or simpler: in the BG console, run:
  chrome.storage.local.get(null, r => console.log(r));
  // and look for a stringified JSON blob containing `unshielded`, `dust`, and the new `zswapViewingKey` field.
  ```

**Pass:** `publicKey` JSON contains a hex-encoded `zswapViewingKey` field (typically 32+ bytes / 64+ chars).

**Fail:** the Zswap derivation (`midnightKeyManager.ts`) didn't fire, or the SDK failed silently. Re-create with a known-good mnemonic (`test test test … test junk`) and capture the BG console output during creation. Likely culprits: the `pbkdf2/sha512` shim from the BG bundle didn't gate the Zswap path (`skipCardano: true` is set on the build-sign call but `deriveMidnightKeys` is called from the welcome dialog without the flag — check the welcome dialog imports).

## Phase 3 — Login opens the indexer shielded session

- [ ] After creating the wallet, log in normally (close + reopen extension if needed to force a fresh WS).
- [ ] Open the BG console; look for `🌙 Midnight sync: starting with shielded subscription enabled`.
- [ ] In SigNoz, run:
  ```
  service=gero-sync severity=INFO body CONTAINS "SUBSCRIBE from"
  ```
  Filter for the last 5 minutes. Confirm a `shieldedRequested=true` entry appears with your session's id.
- [ ] Within ~10s, look for:
  ```
  service=gero-sync severity=INFO body CONTAINS "opened indexer session"
  ```
  The log line should include a tagged sessionId (8-char prefix) and the network slug.

**Pass:** both wallet-side log and gero-sync log fire; reconcile reports `≥1 eligible wallet sessions, ≥1 active`.

**Fail by failure surface:**
- **Wallet log missing entirely** — `addresses.zswapViewingKey` was null in `walletManager.service.ts:start()`. Re-check Phase 2.
- **`shieldedRequested=true` shows in gero-sync but `opened indexer session` does not** — connect mutation failed. SigNoz: `service=gero-sync body CONTAINS "connect mutation failed"`. Likely: indexer schema rejected the viewing key (encoding mismatch) or the gero-sync pod can't reach `https://indexer.preview.midnight.network`. Hit the indexer health from inside the pod:
  ```bash
  kubectl exec -n gero deploy/gero-sync -- curl -s -o /dev/null -w "%{http_code}\n" https://indexer.preview.midnight.network/api/v4/graphql
  ```
- **Reconcile reports `0 eligible wallet sessions`** — `AddressRegistry` didn't capture the viewing key. Cross-check `WalletSyncHandler.handleSubscribe` is on v0.1.32 (the log line should include `shieldedRequested=`; if not, the pod's actually still on an older image).

## Phase 4 — Send dialog tab toggle renders

- [ ] In the wallet, open the Send dialog.
- [ ] Verify the Unshielded ▾ | Shielded tabs render at the top (only on wallets created with the viewing key from Phase 2 — a legacy wallet shows the old single-tab layout).
- [ ] Click the Shielded tab.
- [ ] Verify: the balance snapshot now shows `Shielded balance —` + the "shielded balance display is a future release" hint; recipient field's label changes to `Shielded recipient address`; MAX button is hidden.
- [ ] Validation: enter a non-`mn_shield-addr_…` address. Confirm the rule fires: `Address should start with mn_shield-addr_`.

**Pass:** tabs render, per-tab UI behaves as documented.

**Fail:** PR #683 didn't land cleanly. Re-merge order check: `git log --oneline midnight-preview ^development -10` should show the three commits in order — protocol → BG handler → consent UI.

## Phase 5 — Consent flow

- [ ] On the Shielded tab, enter a valid `mn_shield-addr_preview_…` recipient + a small amount (0.01 tNIGHT is fine).
- [ ] Click Sign and send.
- [ ] Verify the ShieldedProvingConsentDialog opens (NOT the send proceeds directly).
- [ ] Verify the three sections render: what Gero Cloud sees, what we don't do, local Docker CTA.
- [ ] Verify the Accept button is disabled until the acknowledgement checkbox is ticked.
- [ ] Click Cancel. Verify: dialog closes, send is NOT attempted, form retains the amount and recipient.
- [ ] Click Sign and send again. Consent re-prompts.
- [ ] Tick the checkbox, click Use Gero Cloud. Consent records, dialog closes, send proceeds without re-auth.

**Pass:** all of the above.

**Fail by surface:**
- **Send proceeds without showing consent** — `hasFreshConsent()` returned true (consent leaked across wallets). Check `chrome.storage.local.get('midnightStore', console.log)` — if `shieldedProvingConsent` is non-null on a fresh wallet, the persistence carried over from a previous test. Wipe and retry.
- **Consent dialog opens but Accept stays disabled after ticking** — `acknowledged` ref isn't bound correctly; check the Vuetify `v-model` on the v-checkbox.
- **Accept clicked but no consent persists** — `ACCEPT_MIDNIGHT_SHIELDED_PROVING_CONSENT` BG handler missing. Re-verify PR #683's `background.ts` diff. SigNoz isn't useful here (BG-only path).

## Phase 6 — End-to-end shielded send

- [ ] After consent acceptance, watch the BG console for:
  ```
  🌙 midnight shielded tx-builder: starting
  🌙 shielded SDK: started, waiting for synced state
  🌙 shielded SDK: synced
  🌙 shielded transferTransaction returned
  🌙 shielded tx serialized
  ```
- [ ] Then the wallet POSTs to nexus's `/tx/prove-and-submit`. Watch the network tab for that request and verify status 200 with a `txHash`.
- [ ] In SigNoz:
  ```
  service=nexus-sidecar body CONTAINS "tx.prove-and-submit-shielded"
  ```
  Confirm a span with `midnight.network=midnight-preview` and `txHash` set in span attributes.

**Pass:** request returns a tx hash, no error toasts, dialog closes.

**Fail by surface:**
- **`waiting for synced state` never logs `synced`** — cold sync is timing out. The first send on a fresh wallet legitimately waits 30s-3m on preview because we re-sync from scratch on every send (state-persistence is a deferred follow-up — see the plan). Wait. If it's longer than ~5m, check that gero-sync's shielded subscription is actually delivering events — phase 3 SigNoz query should show RelevantTransaction dispatches; if zero, the wallet's not getting note data and `waitForSyncedState` will hang.
- **`transferTransaction` throws "insufficient funds"** — the wallet's note set doesn't cover the amount. Either you weren't actually funded with shielded notes, or sync didn't pick them up. Cross-check by sending a small amount of shielded NIGHT to your address from the preview faucet or another wallet first.
- **POST returns 401** — auth gate. Likely the Nexus JWT expired or wasn't sent. Re-login.
- **POST returns 500 with sanitized error** — sidecar's prover failed. The error body is intentionally redacted (witness-data scrubbing from PR #328). Capture the SigNoz span for the request and look at `error.type` / `error.message` (post-sanitization). Possible causes: prover-server down, schema mismatch, or a serialized hex that the proving server can't deserialize.

## Phase 7 — On-chain verification

- [ ] Take the `txHash` from Phase 6's response.
- [ ] Query the Midnight preview indexer directly to confirm the tx landed:
  ```graphql
  # https://indexer.preview.midnight.network/api/v4/graphql
  query {
    transaction(hash: "0x<your-hash>") {
      hash
      block { hash height }
      protocolVersion
    }
  }
  ```
- [ ] Or substrate-side, hit the RPC node:
  ```bash
  curl -s -X POST https://rpc.preview.midnight.network -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"chain_getBlockHash","params":[]}' | jq
  # then chain_getBlock with the returned hash to confirm finalization
  ```

**Pass:** tx is in a block within ~60s. The recipient's wallet (if you have a second wallet on the same preview chain) sees the note appear after its sync catches up.

**Fail:** tx hash returned but not on chain. Possible: sidecar submitted but substrate dropped (insufficient fees, validity check failed). Look at SigNoz `service=nexus-sidecar searchText="submitMidnightTransaction"` for the submit-step duration and any post-submit error.

## Diagnostics to capture if anything fails

Before reporting, collect:

1. **BG service-worker console** — full log from the moment you clicked Sign and send.
2. **Wallet network tab** — all requests to `nexus.gerowallet.io` and the WS frames to `sync.gerowallet.io/ws/sync`.
3. **SigNoz time-window** — 10 minutes around the send, exported as JSON or screencap. Focus filters:
   - `service=gero-sync body CONTAINS "shielded"`
   - `service=nexus-sidecar body CONTAINS "prove-and-submit"`
4. **kubectl pod logs** if the SigNoz pipeline is lagging:
   ```bash
   kubectl logs -n gero deploy/gero-sync --since=10m | grep -i shielded
   kubectl logs -n gero deploy/nexus     --since=10m | grep -iE "prove|shielded"
   ```
5. **The wallet's `publicKey` JSON** so we can verify viewing-key persistence.

## Known holes this runbook doesn't cover

- **Shielded balance display.** The dashboard still shows the unshielded balance only. Not testable until the `shieldedUtxos` plumbing lands.
- **Re-derive viewing key for legacy wallets.** A wallet created before PR #682 won't see the Shielded tab. Tested negative case: phase 4's "legacy wallet shows old single-tab" check.
- **Multi-recipient shielded.** Single recipient only in v1.
- **`initSwap` (shield/unshield bridge).** Separate follow-up; not in scope here.
- **Persisted shielded sync state.** Every send cold-syncs the SDK against the indexer. Phase 6's slow-first-send caveat is the visible symptom.
