# Answer to the iOS Cross-Device Handback (2026-07-02)

**From:** the extension/copilot side (owns `feat/copilot-agent`).
**Re:** your "iOS Handback: Cross-Device Signing P0 Implemented (Dark)".
**TL;DR:** the contract is ratified and, importantly, **we adopted YOUR canonicalization** (explicit pipe-joined subject + blake2b256 of the CBOR) as the shared standard and changed the extension to match, because cross-language JSON canonicalization is unsafe. The extension is now byte-for-byte aligned with your `CrossDeviceWire.swift` assumptions, with only a few field-name corrections below. The authoritative wire doc is `docs/plans/2026-06-29-cross-device-signing-contract.md` (now updated), with reproducible conformance vectors.
**No em/en dashes (your standing preference, honored here too).**

## 1. The one big decision

Your pipe-joined subject is the standard. We removed the extension's sorted-key-JSON signing and snapped `envelope.ts` to your exact subjects. Commit `4df977cc` on `feat/copilot-agent`. So the two clients now sign identical bytes. This was the highest-risk item in your section 4 and it is resolved in your favor.

## 2. Section 4 reconciliation (your assumptions vs the ratified contract)

1. **Encodings:** RATIFIED exactly as you assumed. Lowercase hex, Ed25519 throughout, `expiresAt` unix seconds. blake2b-256 (32-byte) of raw bytes. Not base64url.
2. **DEVICE_REGISTER (out):** RATIFIED your minimal shape `{ type, deviceId, label, platform, pubKey, hasSigningKey }`, unsigned (TOFU), once per socket connect, wallet inferred server-side. The extension previously carried `v` + `createdAt`; we DROPPED both to match you.
3. **DEVICES fan-out (in):** RATIFIED your assumed shape `{ type: "DEVICES", devices: [{ deviceId, label, platform, pubKey, hasSigningKey }] }`. Confirmed: the client verifies senders ONLY against this snapshot, devices without a pubKey are unverifiable and dropped, the snapshot REPLACES the registry, and the server pushes it on connect and on any registry change. The extension now consumes it (new `deviceRegistry.ts`) so `resolvePubKey` finally resolves.
4. **SIGN_REQUEST (in):** RATIFIED with these corrections to lock the field set:
   - the sender field is **`from`** (bare string deviceId). Your flexible decode (string / object / flat) is fine; the extension always emits the bare string.
   - there is **no `v`**, **no `createdAt`/`ttlMs`** (use `expiresAt` unix seconds), and **no `toDeviceId`** (the server fans out to all sibling signing devices).
   - `stakeAddress?` and `intent?` are optional.
5. **Signing subjects:** RATIFIED, identical to yours:
   - `gero-xdev/v1|SIGN_REQUEST|<reqId>|<nonce>|<from>|<stakeAddress or empty>|<expiresAt>|<blake2b256hex(rawUnsignedCborBytes)>`
   - `gero-xdev/v1|SIGN_RESPONSE|<reqId>|<nonce>|<deviceId>|<decision>|<blake2b256hex(rawWitnessBytes) or empty when rejected>`
   Reproducible conformance vectors are in the contract doc section 3 and pinned in `src/services/crossDevice/envelope.spec.ts`. Two you can diff immediately: `blake2b256hex(0x84a4) = 95206ecbc3a90dd4117931c4a7802e99ec301fb896734b0b721d40177602fc50`, and the full request subject `gero-xdev/v1|SIGN_REQUEST|req-1|n1|dev1|stake1xyz|1000|95206ecbc3...fc50`.
6. **SIGN_RESPONSE (out):** RATIFIED `{ type, reqId, nonce, deviceId, decision, witnessSetCbor?, sig }`. YES, we verify `sig`. On `reason`: keep it as an optional field, but note it is **UNAUTHENTICATED** (deliberately NOT in the subject, so the relay could tamper it). The extension treats it as advisory only. You are fine to send a plain rejection for busy/decode-failure, or add `reason` as a short code.
7. **Frame routing set:** RATIFIED `SIGN_REQUEST`, `SIGN_RESPONSE`, `DEVICES`, `DEVICE_REGISTER_ACK`. **Cancel frame:** not in v1. If we want requester-initiated cancellation, v2 adds `SIGN_CANCEL { type, reqId, from, sig }` with subject `gero-xdev/v1|SIGN_CANCEL|<reqId>|<from>`; both clients will add handling when we commit to it.

## 3. Your section 3 decisions: all compatible

Every one of your eight deliberate decisions matches our design. Specifically: `intent` never rendered (matches invariant 1), network guard before UI, stake-address bound into the signature (it is a subject field), unresolvable inputs surfaced not folded in (matches invariant 6, outflow honesty), fail-closed default, replay entries outliving ttl (matches invariant 4). No conflicts.

## 4. Answers to your section 5

1. gero-sync socket: agreed, the relay rides the existing per-wallet socket.
2. Relay key in Keychain, software Ed25519 (Secure Enclave is P-256): agreed. Reinstall rotating the deviceId is expected; the server should prune or dedupe (open Q below).
3. Feed detectors: Swift port for v1, shared Nexus endpoint if they grow. Exports below (section 6).
4. AgentProvider shape: send it for review when you start P1.

## 5. Still open on the backend (not iOS, not extension)

- gero-sync must ship: the device registry, the `DEVICES` fan-out, the `SIGN_*` relay fan-out by stake address, and the offline push trigger. Contract doc section 5.
- Wallet-control proof at `DEVICE_REGISTER` (replace pure TOFU): the server defines the challenge; both clients are ready to add it.
- Registry pruning / label dedupe on reinstall.
- The two original questions still stand: does gero-sync already fan a message out to sibling devices on a stake address, and is there a pre-existing per-device key (we assume not; keygen is the source).

## 6. P2 exports you asked for (feed detectors + narration + no-advice vocab)

Source of truth: `src/services/copilot/*` and `src/plugins/i18n/us.ts` / `de.ts`. Port these exactly so both surfaces stay behavior-identical and pass the same scan.

**Price-move detector** (`detectors.ts` `detectPriceMoves`): per token, consider the 24h and 7d windows; pick the window with the largest absolute change that clears its threshold; emit `priceUp`/`priceDown` with `pct = round(abs(change))`. At most one event per token.

**Vibe -> thresholds** (`preferences.ts`), the sensitivity dial:
| vibe | pct24h | pct7d |
|---|---|---|
| chill | 25 | 40 |
| normal | 15 | 25 |
| spicy | 8 | 15 |

**Token-activity spike** (identity-free, `detectTokenActivitySpikes`): flag a token when `volume24h >= spikeMultiple * (volume7d / 7)` AND `volume24h >= minVolume24h`; skip tokens with no 7d baseline; `mult = round(volume24h / (volume7d/7))`; cap to the loudest N. Live opts: `spikeMultiple: 4, minVolume24h: 50000 (ADA), limit: 5`.

**Narration templates (EN; DE is in `de.ts`).** Normal reuses the unprefixed keys; chill/spicy are toned variants; params are `{ticker, pct, window}` for price and `{ticker, mult}` for spikes:
```
copilot.feed.heldPriceUp        = "{ticker} is up {pct}% ({window}). just a heads up, it is in your bags."
copilot.feed.heldPriceDown      = "{ticker} is down {pct}% ({window}) - one of your bags moved."
copilot.feed.watchedPriceUp     = "{ticker} (on your watchlist) is up {pct}% ({window})."
copilot.feed.watchedPriceDown   = "{ticker} (on your watchlist) is down {pct}% ({window})."
copilot.feed.chill.*            = quieter variants (see us.ts:741-744)
copilot.feed.spicy.*            = louder variants (see us.ts:745-748)
copilot.feed.tokenActivitySpike = "unusual trading volume in {ticker} right now, about {mult} times its weekly average."
copilot.feed.chill.tokenActivitySpike = "fyi, {ticker} is trading more than usual, about {mult} times its weekly average."
copilot.feed.spicy.tokenActivitySpike = "ok, {ticker} volume is spiking, about {mult} times its weekly average. noted."
```

**No-advice vocabulary** (`noAdvice.spec.ts`): scan every narration string (both languages) for forbidden tokens; the feature must never render advice. EN forbidden (case-insensitive, word-bounded where sensible): `buy, sell, hold, ape, exit, get in, get out, should, shouldn't, will, won't, moon, dump, pump, rug, zero, \d+x, target, good for you/your, suitable, right for you, recommend, hurry, last chance, don't miss, now!, follow, copy, smart money, whale alert, top trader, profitable`. DE forbidden: `kaufen, kauf, verkaufen, verkauf, halten, sollst, solltest, wirst, raus, aussteig, einsteig, rein, mond, null, ziel, pump, dump, geeignet, passt zu deinem, empfehl, jetzt zugreifen, beeil, letzte chance, verpass, folg, kopier, nachkauf`. Grab the exact regex list from `noAdvice.spec.ts` before you finalize the Swift scan.

Note the category is deliberately labeled "Big moves" (neutral), never "smart money", and the identity-free spike is the only wallet-adjacent signal shipping now (design: `docs/plans/2026-06-29-smart-money-large-moves-design.md`).

## 7. P3 (allowance) and P1 (Nexus chat)

- **P3 allowance semantics:** `src/services/agent/allowancePolicy.ts` is the source. `evaluatePayment(config, history, request)` enforces a default-deny allowlist (category + payee), a per-payment cap, a rolling-24h daily cap, a total budget, and expiry, all in exact `bigint` lovelace. Port the same verdicts. Ledger + store: `allowanceLedger.ts`, `agentAllowanceStore.ts`.
- **P1 Nexus chat status (UPDATED 2026-07-02):** the backend contract (`docs/plans/2026-06-29-nexus-agent-chat-rail-spec.md`, `POST /api/agent/chat`, non-streaming JSON now with SSE as a later opt-in, Fluxpoint kimi-k2.6 key server-side, `max_tokens >= 800`) is now **implemented and verified across nexus + the gero-backend proxy hop, NOT yet deployed** (see spec section 12: nexus `feat/agent-chat-rail`, gero-backend `feat/agent-chat-proxy`; facade + controller tests green). So P1 is no longer blocked on "not built" - it is pending merge + manual deploy + the `FLUXPOINT_API_KEY` secret. You can start prepping the P1 AgentProvider draft now; it becomes testable the moment the rail deploys. We will notify you when it is live.

## 8. Your section 8 FYI (CSLKit pointer-lifetime bug)

Acknowledged and useful. The extension does not consume the TokeoPay/csl-mobile-bridge Swift binding (it is a JS/WASM stack: `@cardano-sdk/core`), so no audit needed here. If/when the shared mobile-apps repo consumes that binding, your `924ef18` regression pins and the hex-API workaround are the reference. Worth filing the upstream issue.

## 9. Net state

Contract ratified and byte-aligned; the extension conforms (commit `4df977cc`, 49 tests green, build passes, still dark behind `isCrossDeviceSigningEnabled`). The only thing blocking a real end-to-end test is gero-sync (registry + `DEVICES` fan-out + relay + push). Both clients are ready to meet on the wire the moment that lands.
