# v2 CHALLENGE frame — design (server nonce for DEVICE_REGISTER freshness)

**Date:** 2026-07-03
**Status:** designed + adversarially verified (3 independent designs converged; 3-lens verify pass). **Recommendation: DEFER the enforce flip.** Ship the permissive relay scaffold only opportunistically; the higher-value hardening is encrypting the relay-auth key at rest. Design is captured here so it is build-ready if/when cross-device signing approaches GA.
**Closes:** the v1 residual "same-wallet register-replay" (a captured `DEVICE_REGISTER` + wallet proof replayed to make a ghost device appear live in the pairing list).

---

## TL;DR decision

Three independent designs (relay-auth-freshness, fold-into-wallet-subject, minimal) all reached the **same architecture and the same verdict**:

- **Architecture:** freshness is proved with the **relay-auth key** (available at every reconnect, no user auth), NOT the wallet key. The v1 wallet proof stays byte-for-byte static/cached and sibling-verified. Two new frames (`CHALLENGE` / `CHALLENGE_RESPONSE`), relay-verified liveness, permissive-by-default with a deliberate `enforce` flip. Cache model untouched.
- **Verdict:** the threat is genuinely modest. The replay is already "useless to an attacker lacking the relay-auth privkey," and an attacker **with** that key defeats CHALLENGE too (they just sign the nonce). What v2 buys is narrow: a replayed proof can't make a *ghost device appear live* in the pairing list. On a dark feature with zero in-the-wild pairings, that does not justify a coordinated 3-repo protocol change now. **The relay-auth key sits plaintext in `deviceIdentityStore.ts`; encrypting it closes more of this same threat with no protocol change.** Do that first.

The adversarial pass also found a **real medium bug** in the naive design (see §5) that MUST be fixed before any `enforce` flip.

---

## 1. Why the wallet key cannot carry the nonce

The v1 residual literally says "append `|<serverNonce>`" to the proof subject. That is **unworkable**: the wallet proof is signed once at enable-time with the stake key (password/PRF), cached (`deviceProofStore.ts`), and re-sent verbatim on every reconnect with **no user auth**. A per-connection nonce inside the wallet subject would force a fresh wallet-key signature at every reconnect — violating the hard constraint "MUST NOT require the wallet key at reconnect."

So the nonce is signed by the **relay-auth Ed25519 key** (`deviceIdentityStore.privKeyHex`) — the same key that already signs every `SIGN_REQUEST`/`SIGN_RESPONSE` (`envelope.ts`), available at every reconnect with zero auth. Two independent facts, two keys, two verifiers:
- **Relay** verifies *liveness* (relay-auth sig over its own fresh nonce — it already stores `DeviceInfo.pubKey`, so this is not a wallet-trust op).
- **Siblings** verify *wallet binding* (the COSE wallet proof, `registerProof.ts`, **unchanged**, fail-closed).

## 2. Wire frames (additive, camelCase, dispatched by the existing raw-`type` switch)

Relay → client, issued once per SUBSCRIBE (same site as the current `broadcastDevices` on join):
```
{ "type":"CHALLENGE", "nonce":"<base64url, 32 random bytes>", "expiresAt":<unixSeconds> }
```
Client → relay, sent from the register() path once a CHALLENGE has been seen (does NOT block DEVICE_REGISTER):
```
{ "type":"CHALLENGE_RESPONSE", "deviceId":"<hex>", "pubKey":"<relayAuthPubKeyHex>",
  "nonce":"<echoed verbatim>", "sig":"<hex Ed25519 over the canonical subject>" }
```
`DEVICE_REGISTER` is **byte-identical to today** (still carries the optional wallet `proof`). Optional advisory `CHALLENGE_ACK { deviceId, verified }`, symmetric with `DEVICE_REGISTER_ACK`.

## 3. What is signed

Canonical pipe-joined UTF-8, same discipline as `envelope.ts buildSubject` (NO JSON; lowercase hex; domain-separated; reuse `gero-xdev/v1`):
```
subject = 'gero-xdev/v1|CHALLENGE|' + deviceId + '|' + relayAuthPubKeyHex + '|' + stakeAddress + '|' + nonce
```
- `deviceId` = `deviceIdFromPubKey(relayAuthPubKeyHex)` (= `sha256(pubKeyBytes)[0:16]` hex).
- `relayAuthPubKeyHex` = `DeviceInfo.pubKey`, lowercase hex.
- `stakeAddress` = the session's `monitorAddress` (relay re-derives from `ClientSession`, **never** trusts a client-supplied value) — binds the answer to THIS wallet, so a nonce captured on wallet A can't be answered for wallet B.
- `nonce` = the exact CHALLENGE string, echoed verbatim.
- Signed with `ed25519.signAsync(utf8(subject), relayAuthPriv)` — identical primitive/encoding to `envelope.ts`, so it drops in as `signChallengeResponse()` next to `signMessage()`. This is the plain relay-auth path (NOT COSE; no emurgo).

Domain tag `|CHALLENGE|` (distinct from `|DEVICE_REGISTER|`, `|SIGN_REQUEST|`) prevents cross-context signature reuse. Including `deviceId`+`pubKey` in the subject means a captured `CHALLENGE_RESPONSE` for device A cannot be re-pointed to device B.

## 4. Relay verification + rollout

**Relay verifies** (a relay-auth-key op, permitted): session has SUBSCRIBE'd; `msg.nonce` == the session's outstanding, unexpired, unconsumed nonce; `deviceId == sha256(hexToBytes(pubKey))[0:16]`; re-derive subject from `deviceId`+`pubKey`+`cs.getMonitorAddress()`+`nonce` and Ed25519-verify `sig` against `pubKey` (BouncyCastle/JCA Ed25519). On success: mark the device `verified=true`, consume the nonce (single-use). **Siblings verify nothing new.**

**Nonce lifecycle:** 32 bytes `SecureRandom`, per-socket on `ClientSession` (new `volatile` triple: `challengeNonce`, `challengeNonceExpiry`, `challengeConsumed`), dies with the socket (no reaper). 120s TTL. One nonce per SUBSCRIBE, single-use.

**Rollout flag** `crossdevice.challenge.mode = off | permissive | enforce`, **default `permissive`** so the auto-deploy-on-merge relay is harmless before clients ship:
1. Relay ships CHALLENGE issue + CHALLENGE_RESPONSE verify (permissive) — auto-deploys; old clients ignore the unknown `CHALLENGE` type.
2. Extension ships the responder (`CHALLENGE` handler → `signChallengeResponse` → send; also send from `register()` when a nonce is cached).
3. iOS ships the identical responder in `GeroSyncClient.swift`.
4. **DELIBERATE FLIP** to `enforce` only after telemetry confirms both clients answer. Mirrors the v1 fail-closed rollout.

A conformance vector (fixed `deviceId`, `pubKey`, `stakeAddress`, `nonce` → exact `subject` → exact `sig`) MUST be pinned in TS + Swift + the Java verify test before coding crypto — the same discipline as the COSE vector. A `sha256`-of-hex-vs-raw-bytes mismatch silently fails every verify.

## 5. MANDATORY fix before enforce — do NOT ship a one-shot challenge

**Adversarial finding (medium):** the challenge is one-shot per SUBSCRIBE, but the extension's 25s keep-alive (shipped in #750) makes the socket **long-lived and non-reconnecting by design**. If the single `CHALLENGE` frame (or its response) is dropped without closing the socket — a proxy drop, a handler throw racing the gzip path, or the pre-`onCrossDeviceMessage`-wired window — the device stays `verified=false` for the socket's multi-hour life. In `enforce` mode it is withheld from `broadcastDevices` forever → **permanent silent unpairing**, with the client believing it is paired (it got `DEVICE_REGISTER_ACK`). The design's "reconnect → new nonce" self-healing is defeated by the very stickiness that made the feature usable.

**Fix (relay-side, no client retry logic):** in `broadcastDevices`, re-mint + re-emit `CHALLENGE` to any sibling session whose device is still `verified=false` with an absent/expired nonce. `broadcastDevices` already fires on every join/register/disconnect, and the 25s keep-alive gives a natural re-challenge cadence. Still exactly one nonce per socket (DoS profile unchanged), but no single-point-of-failure. **This is a prerequisite for `enforce`, not optional.**

## 6. Verify-pass results (for the record)

| Lens | Verdict | Note |
|---|---|---|
| downgrade | holds (none) | all downgrades = denial-of-pairing, never silent bypass; siblings still verify wallet binding; do NOT expose a relay `live:true` bit siblings could trust |
| cache-model | holds (none) | cold MV3 reconnect traced line-by-line: zero wallet-key dependency; guardrail = `signChallengeResponse` uses only `identity.privKeyHex`, `getProof()` stays a pure in-memory read |
| ordering-liveness-dos | **breaks (medium)** | §5 one-shot-vs-sticky-socket; fixed by re-challenge-on-broadcast |
| replay | (verifier failed structured-output cap) | covered by design self-analysis: subject binds deviceId+pubKey+wallet+nonce; single-use per-session nonce; no cross-context/cross-wallet lift |
| value-vs-complexity | (verifier failed) | covered by unanimous worthIt below |

## 7. Residuals (unchanged by v2) + the recommended alternative

- **Relay-auth key at rest is plaintext** (`deviceIdentityStore.ts`). A thief of that key answers challenges AND signs `SIGN_REQUEST`/`RESPONSE` — CHALLENGE proves possession of exactly this key, so a stolen key defeats it. **This is the higher-value fix and it needs no protocol change or cross-repo coordination.** Recommended before (or instead of) CHALLENGE.
- **Relay trusted for liveness listing** — a power it already had in v1 (it can omit/inject DEVICES entries). Not a regression; wallet binding stays sibling-verified.
- **Single-node nonce** — correct under WS-pinned-to-one-node (already the DeviceRegistry assumption). Needs shared storage only if gero-sync horizontally scales WS fan-out.
- **Permissive = open** — the residual only closes at the `enforce` flip; deferring enforce means the residual stays documented-but-open (accepted, given its modesty).

**Bottom line:** the design is correct, clean, and additive, and reuses the exact key + subject discipline already in the code. But the marginal security is small and gated behind a bigger unfixed residual. Recommended order: (1) encrypt the relay-auth key at rest; (2) treat CHALLENGE as a GA-hardening item — build the permissive scaffold when gero-sync is next touched, wire the responders as a small rider on the client work, and only flip `enforce` (with the §5 re-challenge fix) if/when the feature exits dark.
