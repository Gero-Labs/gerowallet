# Remote signing settings — design

**Date:** 2026-07-03
**Status:** Phase 1 in progress
**Context:** Cross-device signing shipped and is E2E-verified on mainnet (desktop proposes, phone approves). This adds user-facing security controls on top: trusted-device pinning, a signing policy ("2FA" / remote-required), and device visibility.

## Threat model this closes
`DEVICE_REGISTER` is trust-on-first-use, keyed only by the **public** stake address. So today any party that knows your stake address can register a device on your wallet group and:
1. Receive `SIGN_REQUEST` fan-outs (the unsigned tx CBOR) — privacy / front-running leak.
2. Send a signed rejection to DoS a request (first response decides).

There is **no fund-loss path** (the witness must be valid for the user's own keys; the desktop re-checks the tx body hash before submit; the phone decodes the CBOR independently). So this feature is about **authorization policy + confidentiality + anti-DoS**, not about preventing theft.

## Honest security boundary
Both the desktop and the phone hold the **same** wallet keys — this is not multisig. The "2FA" / remote-required policy is a **client-enforced gate**: it protects against someone who has one device/credential but not the paired device. It does not defend against a maliciously modified wallet binary. This is the same boundary as the industry-standard mobile-approval prompt, stated plainly in the UI.

## Model
Per-wallet security config (stored in the wallet-db `config` table, same place as `unlockMethod` / `autoLockMinutes`), keyed by wallet id:

```
remoteSigning: {
  enabled: boolean            // user opt-in for THIS wallet (default false)
  policy: 'ask' | 'require_remote'
  trustedDevices: {
    [deviceId]: { deviceId, pubKey, label, platform, trustedAt }
  }
}
```

- **`enabled`**: master per-wallet switch. The Send "Sign on another device" button and the relay bootstrap participation both require it. (The server flag `isCrossDeviceSigningEnabled` still gates whether the feature exists at all.)
- **`policy`**:
  - `ask` (default): sign locally, remote is an optional button.
  - `require_remote`: **Send must be approved by a trusted device**; local signing for Send is disabled. The local spending password still gates *initiating* the request, so it is a genuine second factor.
- **`trustedDevices`**: pinned by `(deviceId, pubKey)`. Since `deviceId = sha256(pubKey)[:32]`, the id already binds the key; we store and re-check both and **fail closed** on any mismatch.

## Trust default: pairing required
Once remote signing is enabled, **only explicitly trusted devices participate**. A newly-seen device shows as "untrusted — needs pairing". Pairing = compare a short **fingerprint** (SAS-style, derived from the device pubkey) shown on both screens, then tap Trust.

## Three enforcement points
1. **Requester accept-gate** (desktop, `crossDeviceSigning.service` inbound `SIGN_RESPONSE`): after signature verification, drop responses from **untrusted** devices. Closes DoS-by-rejection and ignores rogue approvals.
2. **Approver show-gate** (device acting as approver, inbound `SIGN_REQUEST`): only dispatch to the approval handler for **trusted** requesters. (Desktop-as-approver in Phase 1; iOS mirrors in Phase 2.)
3. **Local-sign gate for Send** (`useTransactionSigning` + `SendSheet`): when `policy === 'require_remote'`, hide/disable local Sign and route to `signOnAnotherDevice`.

Gates 1 and 2 are pure predicates injected into the transport-agnostic service (kept unit-testable); the bootstrap wires the real per-wallet check.

## IP: informational only
The relay stamps each device with a last-seen IP + coarse location; shown read-only in the trusted-devices list so a rogue device is visible and can be untrusted. No IP allowlist / lockout (mobile IPs rotate). Requires a small relay addition to include `lastSeenIp`/`geo` in the `DEVICES` snapshot (Phase 2 relay); Phase 1 UI shows platform + label + fingerprint + trustedAt and leaves an IP slot.

## UI
`SecurityTab.vue` gains a "Remote signing" row (Cardano + Normal wallet only), opened **behind the existing verification overlay** (password/pin/pattern/passkey — reuse the exact pattern already gating Lock Settings). It opens `RemoteSigningDialog.vue`:
- master enable toggle
- policy selector (Ask / Require remote for Send) with the honest-boundary caption
- trusted devices list: each device's label, platform, fingerprint, trustedAt, Trust/Untrust; live "detected but untrusted" devices from the registry
- this device's own fingerprint for cross-checking

All settings mutations are auth-gated (the verification overlay) and never log key material.

## Phase split
- **Phase 1 (extension only, this work):** config schema + background-readable state + messages, the two service trust gates + the Send policy gate, the settings UI, EN/DE i18n, tests. Non-breaking: defaults preserve today's behavior except that the user must enable remote signing per-wallet and pair the phone once (the chosen secure default).
- **Phase 2:** relay `to`-targeting (send `SIGN_REQUEST` only to a trusted device, closing the CBOR-fanout privacy leak) + `lastSeenIp`/geo in `DEVICES`; iOS mirror (pairing fingerprint UI + requester-trust gate on the phone); `DEVICE_REGISTER` wallet-control proof so registration is authenticated, not TOFU.

## Messages (background)
- `GET_CROSS_DEVICE_SETTINGS` -> `{ enabled, policy, trustedDevices }`
- `SET_REMOTE_SIGNING_ENABLED { enabled }`
- `SET_CROSS_DEVICE_POLICY { policy }`
- `TRUST_CROSS_DEVICE { deviceId }` / `UNTRUST_CROSS_DEVICE { deviceId }`
- `GET_CROSS_DEVICE_DEVICES` -> live registry snapshot (detected devices, trusted flag)

Background keeps an in-memory per-wallet settings mirror (loaded from wallet-db on login, same lifecycle as the cross-device bootstrap) so the service's trust predicates are synchronous.
