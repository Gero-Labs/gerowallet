# Desktop → iOS handoff: cross-device QR pairing + wake, interop-flip readiness

**Date:** 2026-07-05
**From:** desktop (extension) + relay side
**To:** iOS cross-device agent
**Companion docs:** `docs/handoff/2026-07-04-ios-qr-pairing-ux.md` (UX + iOS contract), `docs/plans/2026-07-04-qr-pairing-desktop-plan.md` (desktop plan)

## TL;DR
The **APNs wake fix is merged and deploy-ready** on both repos. The **desktop QR-pair Steps 0–2 are built** (protocol, envelope, nonce store, QR payload, and the inbound `PAIR_CONFIRM` verify + auto-pin security core), sitting on `feat/crossdevice-qr-pairing` pending a security review + the UI. The contract is confirmed **byte-aligned** with iOS. Two things gate the interop flip: the desktop QR **dialog** + **`PAIR_ACK`** (I need its exact shape from you), and the security review.

## 1. Wake fix — MERGED, deploy-ready
The first locked-phone wake test failed because of three now-fixed causes (relay session-leak + `relayed` miscount + the desktop never targeting an offline signer). Both PRs are merged to `development`:
- gerowallet `#763` (`6d7cdefa`) — target + offer a trusted-but-offline signer; persist `hasSigningKey`.
- gero-sync `#21` (`92e52f7`) — `ClientSession` identity equals/hashCode + count only live relays. Also lands the previously-unmerged APNs-activation commit.

**Action (Adam):** deploy both (relay: build/push + `kubectl set image`; extension: rebuild) → then iOS can re-run the locked-phone wake. Confirmed on our side: `to` is the persisted deviceId, stored verbatim, so it matches the `DEVICE_REGISTER` id that keys the relay `PushTargetStore`.

## 2. Contract — confirmed byte-aligned (no divergence)
- **`PAIR_CONFIRM` signed subject** (pinned both sides, cross-vector tested):
  ```
  gero-xdev/v1|PAIR_CONFIRM|<from>|<pubKey>|<to>|<nonce>|<stakeAddress>
  ```
  `to` is **inside** the subject (binds the scanned desktop; blocks cross-desktop replay). Golden vector `…|ios-abc|deadbeef|ext-123|nonce1|stake1uxyz` is pinned in our `envelope.spec.ts` and (per your note) mirrored in your `CrossDevicePairingTests` — so neither side can drift silently.
- **QR payload shape** (now pushed to `origin/feat/crossdevice-qr-pairing`, so you can pin real code, not the plan doc): `{ v: "gero-xdev-pair/v1", deviceId, pubKey, stake, proof, nonce, exp }`. Field names match your expectation exactly. Encoding is plain JSON today (you accept that + the `base64url(deflate)` fallback); we kept encode/decode in one function so we can switch to the deflate form if the proof pushes past QR capacity.
- **`stakeAddress` transmit fix** (your `7eb8a92`): confirmed our side **requires** `stakeAddress` top-level — `isPairConfirm` drops any frame without it, so the desktop fails **closed** (never mis-verifies) rather than dying silently. Your transmitting it closes the loop.
- **deviceId derivation**: confirmed both sides use `sha256(pubKey)[0:16]` (lowercase hex). We therefore **keep** `isDeviceIdConsistent` on the pin as cheap defense-in-depth (the earlier "iOS uses a UUID, skip it" note was wrong and is corrected in the docs).

## 3. Desktop security decisions you should know (mirror on your reasoning)
- **Proof is the authority, not the frame.** `handlePairConfirm` verifies `verifyDeviceRegisterProof(frame.proof, {frame.from, frame.pubKey}, ourOwnStake)`. The frame's `stakeAddress` is **advisory** — used only to reconstruct the subject for the envelope sig check, **never** as the expected wallet. An attacker on another wallet can sign a valid frame but cannot forge a proof binding their key to our stake key-hash. (This mirrors what you do with the QR proof.)
- **Ordering: proof-first, then nonce-consume** (a deliberate deviation from the plan's nonce-first). Rationale: nonce-first lets anyone who photographs the QR send a bad-proof frame (its own-key sig passes the frame check) that **burns the nonce** and DoSes the real pair. Proof-first drops that frame without touching the nonce, so the real phone still pairs; single-use/replay is unchanged (a replayed valid confirm re-verifies the proof but the nonce is already used → rejected). **This exact decision is under an adversarial security review right now** — if it flips, I'll update you, but it does not change the wire contract.
- **`to` == self, and ignore self-echo.** The service accepts only confirms addressed to this desktop's deviceId and drops our own echoed frame, before the proof check.
- **QR path hard-requires the proof** regardless of `REQUIRE_PROOF_TO_PAIR` (that flag only gates the legacy SAS path).

## 4. What's left on desktop before the flip
| Item | State |
|---|---|
| Step 0 — protocol + envelope + relay allowlist | ✅ committed |
| Step 1 — `pairingNonceStore` + `pairingQr` payload | ✅ committed + pushed |
| Relay — `PAIR_CONFIRM`/`PAIR_ACK` forwarding | ✅ merged to `development` (`#22`) |
| Step 2 — inbound `PAIR_CONFIRM` verify + auto-pin (security core) | ✅ committed; 🔎 **security review in progress** |
| Step 2 — QR dialog (`GET_PAIRING_QR` + `RemoteSigningDialog` + poll) | ⏭️ next |
| Step 2 — **`PAIR_ACK` send** | ⏭️ blocked on your exact shape (see §5) |

## 5. What I need from iOS
1. **The exact `PAIR_ACK` frame + signed-subject shape you listen for.** You said iOS matches on **nonce or sender**, 2.4s-bounded. I'll build the desktop to emit `PAIR_ACK` carrying `from` (desktop deviceId), `to` (phone), and the echoed `nonce`, and I'll **sign it** (Ed25519 over a subject, so the phone can verify it against the desktop's pinned pubkey) — *unless your listener expects it unsigned*. Please paste the precise frame JSON + subject bytes so it's byte-perfect.
2. **Confirm your `PAIR_CONFIRM.to`** is set to the **scanned desktop's deviceId** (from the QR), not left blank — our service drops any confirm whose `to` != our deviceId (defense-in-depth; the relay also routes on it).
3. **Push `7eb8a92`** when you're ready for the flip (holding per Adam's rule until then).

## 6. Interop flip sequence (when both sides + deploy are ready)
1. Deploy `development` on both repos (wake fix + relay forwarding).
2. Merge the desktop QR branch (after security review + dialog + `PAIR_ACK`), rebuild the extension.
3. Push the iOS QR commit.
4. Flip the dark flag for the dev user on both clients.
5. Real scan: desktop shows QR → phone scans → phone verifies desktop proof + pins → `PAIR_CONFIRM` → desktop verifies phone proof + pins (`verified:true`, green badge) → `PAIR_ACK` → phone shows confirmed. Then a locked-phone `SIGN_REQUEST` should APNs-wake and complete.

Ping me with the `PAIR_ACK` shape and I'll close out Step 2.
