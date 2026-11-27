# gero-vault-invite/v1: GeroVault cosigner invitations

Wire contract for inviting cosigners into a GeroVault (issues #1771 GV-85, #1772 GV-86, #1773 GV-87).
Written for the implementers of gero-sync (Java), the extension (TypeScript, this folder), iOS
(Swift) and Android (Kotlin).

**Status: PROVISIONAL.** Frozen once gero-sync, iOS and Android reproduce
`__fixtures__/invite-vectors.json` byte for byte. Any change to a tag, a field, an encoding or a
limit below is a contract change: it regenerates the vectors and every client follows.

The TypeScript reference is pure (no clock, no randomness, no storage):

| File | What it holds |
|---|---|
| `constants.ts` | every tag, limit and wire name in this document |
| `codec.ts` | strict base64url, the X25519 key check, the strict CBOR record reader |
| `payloads.ts` | INVITE, ACCEPT, DECLINE, REVOKE: encode, decode, digests, full checks |
| `seal.ts` | encryption with per-recipient wraps, the link-key seal, server decoys |
| `link.ts` | QR / link payload, capability derivations |
| `flows.ts` | what each side runs on what arrives |

---

## 1. Model in one page

- The **initiator** creates a vault setup on one device. Each **cosigner** is invited either
  remotely (by stake credential, through gero-sync's mailbox) or in person / by link (a QR or
  `https://gerowallet.io/vault-invite#…` carrying a one-time capability).
- Every device has an **X25519 invite key pair**, separate from its Ed25519 relay key. The public
  key is published with `PUT /device` (`inviteKey`); the secret stays in the background's private
  store (extension-origin IndexedDB, `privateStore.ts`), never in `chrome.storage.local`.
- gero-sync is a **mailbox**. It stores ciphertext, routes it to devices, and pushes a pointer
  (`{ t, setupId }`). It never sees a vault name, a label, a key, a participant or a digest.
- The **trust anchor is the GV-61 ceremony** (the 40-digit verification number, #1729). Nothing in
  this protocol verifies a vault. An opened invitation is shown; an opened ACCEPT fills a cosigner
  card as **Unverified**; funding opens only after the ceremony.

```
initiator device                     gero-sync                           cosigner device(s)
POST /vault-setups            ─────►  setup (owner = device)
POST /vault-invites/recipients ────►  5 × {slot, inviteKey}  (real ≤5, rest decoys)
seal INVITE to all 5 keys
POST …/invites                 ────►  stores; push {t:vault_invite, setupId} ─────► wake
                                      GET /vault-invites  ◄────────────────────────  fetch own wrap
                                                                                     open, show, approve
                                      POST …/responses (ACCEPT sealed to replyKey) ◄─ accept
push {t:vault_response} ◄──────────── store
GET …/responses ───────────────────►  ACCEPT ciphertext
open, check, fill card "Unverified" … GV-61 number read over a call … Verified
```

---

## 2. Encodings

### 2.1 Canonical CBOR

All payloads are CBOR maps with **text keys**, written in RFC 8949 section 4.2.1 core
deterministic encoding, the same writer as the vault manifest (`../canonicalCbor.ts`):

- shortest integer and length heads, definite lengths only;
- map keys sorted by the bytewise order of their encodings (for text keys: shorter first, then
  bytewise);
- only unsigned integers, byte strings, text strings, arrays and maps. No negative integers, floats,
  booleans, `null`, tags or other simple values appear in this protocol.

**Reading rule (all clients, fail closed):** decode strictly (refuse indefinite lengths, non-minimal
heads, tags, floats, simple values, invalid UTF-8, duplicate keys, trailing bytes), check every
field against section 4, then **re-encode canonically and require byte equality** with the input.
A map with an unknown key, a missing required key, or a key of the wrong type is refused. Optional
keys are omitted when absent (never `null`).

Kotlin / Swift: any CBOR library is fine for reading if you apply the rule above; for writing,
sort keys yourself and emit definite lengths.

### 2.2 Other encodings

| Value | Encoding |
|---|---|
| fixed-size bytes in JSON (keys, ids, hashes, nonces, wraps) | lowercase hex, exact length; uppercase is refused |
| ciphertexts in JSON, the QR/link payload, a REVOKE in JSON | base64url (RFC 4648 section 5) **without padding**; refuse `=`, `+`, `/`, whitespace, a length ≡ 1 (mod 4), and non-zero unused trailing bits |
| times inside payloads and the QR | unix **seconds**, unsigned integer |
| times in the REST API | unix **milliseconds** (as the notify API: `serverTime`, `expiresAt`) |
| network | `"cardano-mainnet"`, `"cardano-preprod"`, `"cardano-preview"` (as the manifest and the notify API) |
| setupId | 16 random bytes chosen by the initiator |
| stake credential | 28 bytes: the key hash of a key-based stake credential (script stake credentials are not supported, as in notify) |
| labels (vault name, participant and inviter labels) | the label rules of `../labels.ts`: readers accept well-formed text of at most 64 UTF-8 bytes without C0/C1 controls and never change it; writers NFC-normalise, trim, and refuse format, private-use, unassigned and blank-looking code points; screens isolate and escape (`displayLabel`) |

### 2.3 Tags

Every hash, MAC, KDF and AAD input is domain-separated with an ASCII prefix that starts
`gero-vault-invite/v1|`. The prefixes are byte-exact, with no terminator other than what is shown.

| Use | Prefix |
|---|---|
| INVITE digest | `gero-vault-invite/v1\|INVITE\|` |
| ACCEPT digest | `gero-vault-invite/v1\|ACCEPT\|` |
| ACCEPT MAC | `gero-vault-invite/v1\|ACCEPT-MAC\|` |
| body AAD | `gero-vault-invite/v1\|<KIND>\|` with KIND ∈ `INVITE`, `LINK`, `ACCEPT`, `DECLINE` |
| wrap HKDF info and wrap AAD | `gero-vault-invite/v1\|WRAP\|<KIND>\|` |
| capability derivations (HKDF info, whole string) | `gero-vault-invite/v1\|LINK\|join-token`, `…\|LINK\|content-key`, `…\|LINK\|mac-key` |
| server decoys (HMAC input) | `gero-vault-invite/v1\|DECOY\|<network>\|` |

---

## 3. Keys and encryption

### 3.1 Device invite key

- 32 random bytes `s`; public `P = X25519(s, 9)` (RFC 7748; `s` is clamped by X25519 itself).
- A **usable** X25519 public key: 32 bytes, top bit (bit 255) clear, `u < p = 2^255 − 19`, and not
  one of the canonical small-order points:
  `00…00`, `01 00…00`,
  `e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800`,
  `5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157`,
  `ecff…ff7f` (p − 1). Every reader also refuses an all-zero shared secret.
- One key for the device's life. A device that loses it (reinstall) publishes a new one; invitations
  sealed to the old key are lost to that device and the initiator re-sends ("Remind" after a new
  directory lookup).

### 3.2 Seal (INVITE, ACCEPT, DECLINE)

Inputs: KIND, `setupId` (16 bytes), plaintext (canonical CBOR, section 4), recipients
`[(slot, R)]`. INVITE has exactly 5 recipients at slots 0 to 4 (the directory, section 7.4);
ACCEPT and DECLINE have exactly 1, at slot 0: the initiator's reply key.

```
K        = 32 random bytes                     (content key)
N        = 24 random bytes
bodyAAD  = "gero-vault-invite/v1|<KIND>|" || setupId
ct       = XChaCha20-Poly1305(K, N, bodyAAD, plaintext)          (plaintext || 16-byte tag)

for each (slot, R):
  e        = 32 random bytes;  E = X25519(e, 9)
  ss       = X25519(e, R)                                        refuse if all zero
  wrapKey  = HKDF-SHA256(IKM = ss, salt = setupId,
                         info = "gero-vault-invite/v1|WRAP|<KIND>|" || slot(1 byte) || E || R, L = 32)
  wN       = 24 random bytes
  wrapAAD  = "gero-vault-invite/v1|WRAP|<KIND>|" || setupId || slot(1 byte)
  wrapped  = XChaCha20-Poly1305(wrapKey, wN, wrapAAD, K)          (48 bytes)
  wrap     = { slot, recipientKey: hex(R), ephemeralKey: hex(E), nonce: hex(wN), wrappedKey: hex(wrapped) }

sealed = { wraps: [wrap…], nonce: hex(N), ciphertext: base64url(ct) }
```

HKDF is RFC 5869 with HMAC-SHA256 (extract with the given salt, then expand; for L = 32 that is
`OKM = HMAC(HMAC(salt, ss), info || 0x01)`). XChaCha20-Poly1305 is the IETF construction
(libsodium `crypto_aead_xchacha20poly1305_ietf`).

A recipient is handed `{ wrap, nonce, ciphertext }` for its own key only. It checks
`wrap.recipientKey == own P` (else `WRONG_RECIPIENT`), recomputes `ss = X25519(s, E)` and
`wrapKey` with **its own** P as R, opens `K`, then the body. Any failure is `DECRYPT_FAILED`.

### 3.3 Plaintext caps

| KIND | max plaintext | max ciphertext (decoded) |
|---|---|---|
| INVITE, LINK | 6144 bytes | 6160 bytes |
| ACCEPT | 3072 bytes | 3088 bytes |
| DECLINE | 128 bytes | 144 bytes |

Readers check the decoded ciphertext length before decrypting.

### 3.4 Server decoys (reference for gero-sync)

```
scalar = HMAC-SHA256(serverSecret, "gero-vault-invite/v1|DECOY|<network>|" || credential(28) || slot(1))
decoy  = X25519(scalar, 9)
```

`serverSecret` is at least 32 random bytes, held only by gero-sync (a Kubernetes secret), and never
rotated casually: rotating it changes every decoy at once (see 8.3). `decoyInviteKey()` in
`seal.ts` is the reference; the vectors pin three decoys.

---

## 4. Payloads

`?` marks an optional key. `bstr N` is a byte string of exactly N bytes. Every payload starts with
`v: 1` (other values: `UNKNOWN_VERSION`) and `kind` (other values: `WRONG_KIND`), except the
signed wrappers, whose `body` does.

### 4.1 INVITE (initiator → cosigner; sealed as KIND `INVITE`, or `LINK` for the link copy)

```
SignedInvite = { body: InviteBody, sig: Attestation }

InviteBody = {
  v: 1, kind: "invite",
  network:      text,                       // section 2.2
  setupId:      bstr 16,
  vault: { name: label, template: "standard", threshold: uint, owners: uint },
  inviter: { label: label, stakeCredential: bstr 28, ? handle: text },
  ? invitee:    bstr 28,                    // the stake credential addressed; absent on a link copy
  participants: [ { label: label, status: "waiting" | "accepted" | "verified" } ],
  replyKey:     bstr 32,                    // the initiator device's invite key (usable X25519)
  vaultKeys: { payment: bstr 32, stake: bstr 32 },   // the initiator's vault keys, raw Ed25519
  revokeHash:   bstr 32,                    // SHA-256(revokeSecret), section 4.4
  issuedAt:     uint,
  expiresAt:    uint
}

Attestation = { method: 0 | 1, proof: bstr (1..2048) }
```

Rules (a reader refuses anything else):

- `template` is `"standard"` this round. `2 ≤ owners ≤ 20`, `2 ≤ threshold ≤ owners`.
- `participants` lists the other participants for display, never the inviter; at most
  `min(19, owners − 1)` entries. Status vocabulary is the canvas's (Waiting, Accepted, Verified);
  a declined cosigner is left out.
- `handle` matches `^\$[a-z0-9_.-]{1,15}$`. It is what the inviter's wallet resolved and is shown
  as "resolved by provider", never trusted.
- `vaultKeys.payment` and `vaultKeys.stake` are Ed25519 public keys in the prime-order subgroup
  (canonical, not small order, torsion-free: `isUsableEd25519Key` in `../attestation.ts`), and
  differ. Never an extended key, never an account or role key (#1683).
- `expiresAt > issuedAt` and `expiresAt − issuedAt ≤ 604800` (7 days), else `LIFETIME_TOO_LONG`.
- `revokeSecret` is 32 fresh random bytes **per sealed INVITE** (each cosigner's invitation and
  each link copy has its own); the initiator keeps it in its private store.

**Digest and signature.**
`inviteDigest = BLAKE2b-256("gero-vault-invite/v1|INVITE|" || canonicalCBOR(InviteBody))`.
`sig` is an attestation by the vault payment key named in `vaultKeys.payment` over that 32-byte
digest, in the stored form of `../attestation.ts`, with attested kind `invite`:

- method 0, CIP-8: `proof = [ bstr COSE_Sign1, bstr COSE_Key ]`, payload = the digest;
- method 1, expired transaction: auxiliary data `{ 18541: { 5: digest } }` (metadatum key 5 =
  invitation, 6 = acceptance), body naming the vault's network.

The credential the attestation must match is `BLAKE2b-224(vaultKeys.payment)`.

**Checks when opening** (`openSignedInvite`, in this order): canonical structure (above); the
channel's expectations (`setupId` the server filed it under → `WRONG_SETUP`; for a link copy also
the QR's `network` → `WRONG_NETWORK` and `replyKey` → `BAD_KEY`); `issuedAt ≤ now + 300` else
`NOT_YET_VALID`; `now < expiresAt` else `EXPIRED`; the attestation (`BAD_SIGNATURE`, with the
attestation's own code as detail). A link copy must also carry no `invitee` and must not expire
before the QR (`link.exp ≤ expiresAt + 300`).

### 4.2 ACCEPT (cosigner → initiator; sealed as KIND `ACCEPT` to `replyKey`)

```
SignedAccept = { body: AcceptBody, sig: Attestation, ? mac: bstr 32 }

AcceptBody = {
  v: 1, kind: "accept",
  network:         text,
  setupId:         bstr 16,
  invite:          bstr 32,       // the inviteDigest of the INVITE body being accepted
  label:           label,         // how the cosigner names themselves
  stakeCredential: bstr 28,       // the accepting wallet's, so the initiator can save a contact
  vaultKeys: { payment: bstr 32, stake: bstr 32 },   // the cosigner's vault keys for this vault
  acceptedAt:      uint
}
```

- `acceptDigest = BLAKE2b-256("gero-vault-invite/v1|ACCEPT|" || canonicalCBOR(AcceptBody))`;
  `sig` attests it with the cosigner's vault payment key (attested kind `inviteAccept`, metadatum
  key 6). Accepting takes the cosigner's next free vault index (#1683) and needs a backed-up
  recovery phrase (#1742); that is client policy, not wire.
- `mac` is present **exactly** when the cosigner joined by QR or link:
  `mac = HMAC-SHA256(macKey, "gero-vault-invite/v1|ACCEPT-MAC|" || acceptDigest)` (section 5).

**Checks when opening** (`openSignedAccept`): structure; `setupId`, `network` and `invite` equal to
the invitation the response was filed under (`WRONG_SETUP`, `WRONG_NETWORK`, `WRONG_INVITE`);
`acceptedAt ≤ now + 300` (`NOT_YET_VALID`); `acceptedAt < invite.expiresAt` (`EXPIRED`); MAC
verifies with the link's MAC key when the response came by link, and is absent otherwise
(`BAD_MAC`); the attestation (`BAD_SIGNATURE`). The initiator then also refuses vault keys that
are already in the setup (its own or another cosigner's).

### 4.3 DECLINE (cosigner → initiator; sealed as KIND `DECLINE`)

```
Decline = { v: 1, kind: "decline", setupId: bstr 16, invite: bstr 32 }
```

Nothing about the wallet. `invite` is the inviteDigest: only someone who decrypted the invitation
knows it, so gero-sync (which knows the initiator's public invite key) cannot forge a decline. No
reason is ever sent.

### 4.4 REVOKE (initiator → cosigner, through gero-sync, **not encrypted**)

```
Revoke = { v: 1, kind: "revoke", setupId: bstr 16, secret: bstr 32, revokedAt: uint }
```

Valid for an invitation iff the `setupId` matches and `SHA-256(secret) == revokeHash`
(`BAD_REVOKE`). It needs no signing approval (no password, no hardware tap) and cannot be forged by
gero-sync before the initiator publishes it. It carries nothing private. `revokedAt` is
informational: once published, the secret is known to gero-sync, so treat `revokedAt` as the
relay's word. Max 128 bytes.

---

## 5. QR and link

```
LinkPayload = { v: 1, kind: "link", network: text, setupId: bstr 16, replyKey: bstr 32, cap: bstr 32, exp: uint }

QR string  = "gvi1" || base64url(canonicalCBOR(LinkPayload))        (≈ 208 characters)
link       = "https://gerowallet.io/vault-invite#" || QR string
```

- `cap` is 32 fresh random bytes **per QR shown and per link copied**. The in-person QR changes
  after every scan that leads to an ACCEPT (UX rule 9): one QR fills one cosigner card.
- `exp`: a QR is short-lived (the extension uses 10 minutes); a copied link lives at most as long
  as its invitation. Readers refuse `now ≥ exp` (`EXPIRED`) and `exp > now + 7 days + 300 s`
  (`LIFETIME_TOO_LONG`).
- Parsing is exact: the input is either the QR string or the link with exactly that scheme, host
  and path; no whitespace, no query, nothing after the payload; at most 512 characters. A `gvi`
  prefix with another digit is `UNKNOWN_VERSION`.
- The fragment never reaches a web server. gerowallet.io's page reads nothing from it; with the
  extension installed the extension opens the invitation; without it the page shows the store
  link and says to open the same link again after installing (extensions have no deferred deep
  link).

Derivations (HKDF-SHA256, `IKM = cap`, `salt = setupId`, L = 32):

| Output | info | Who gets it |
|---|---|---|
| `joinToken` | `gero-vault-invite/v1\|LINK\|join-token` | gero-sync, when the joiner presents it; the initiator uploads only `joinTokenHash = SHA-256(joinToken)` |
| `contentKey` | `gero-vault-invite/v1\|LINK\|content-key` | never leaves devices; the link copy is sealed under it (KIND `LINK`, no wraps, `bodyAAD = "gero-vault-invite/v1\|LINK\|" \|\| setupId`) |
| `macKey` | `gero-vault-invite/v1\|LINK\|mac-key` | never leaves devices; authenticates the ACCEPT (4.2) |

The joiner seals its ACCEPT or DECLINE to `replyKey` **as read from the QR**, so the reply key is
authenticated by the in-person channel, not by gero-sync.

**GV-61:** a scan or a link authenticates *who joined* (whoever held that capability). This round
it does **not** count as GV-61 verification: amendment 2 of #1771 is undecided. The 40-digit number
still verifies every cosigner, in person or not. The MAC key is the hook for that amendment.

---

## 6. Flows (client side)

**Initiator, remote invite.**
1. `POST /vault-setups` with a fresh `setupId` and `expiresAt` (≤ 7 days).
2. Resolve the entry ("Name, $handle or address") to `(network, stakeCredential)` locally.
3. `POST /vault-invites/recipients` → 5 entries. Check each key is usable (a bad key is a broken
   server: stop).
4. Build the InviteBody (fresh `revokeSecret`, `invitee` = the credential), have the vault payment
   key attest it (one approval), seal to the 5 entries, `POST /vault-setups/{setupId}/invites`.
   Keep `inviteId`, the inviteDigest, `revokeSecret` and `expiresAt` in the private store.
5. On a `vault_response` push (or when the screen opens), `GET …/responses`, open each with the
   reply secret (`openAcceptResponse` / `openDeclineResponse`), dedupe by acceptDigest, and fill
   the card as Accepted + Unverified, or Declined.

**Initiator, QR or link.** Fresh `cap`, its own link copy (same as step 4 but no `invitee`, no
wraps: `sealWithLinkKey`), `PUT /vault-setups/{setupId}/links/{joinTokenHash}`, show the QR or copy
the link. After an ACCEPT through it, show a new QR (new `cap`) and `DELETE` the old link.

**Cosigner.** On a `vault_invite` push: `GET /vault-invites`, open each open invitation
(`openMailboxInvite`), show it (from a known contact or shared vault → "Needs you", otherwise →
"Requests"). Accept: next free index, vault keys, attestation, seal to `replyKey`,
`POST …/responses {kind: "accept", inviteId}`. Decline: `{kind: "decline", inviteId}`. By link:
`parseInviteLink`, `POST /vault-invites/by-link {joinToken}`, `openLinkInvite`, then answer with
`joinToken` and the MAC.

**Revoke.** `POST …/invites/{inviteId}/revoke` with the REVOKE (base64url). The cosigner device
shows "Revoked by <inviter label>" only after `openRevoke` succeeds against its stored invitation;
otherwise "no longer available".

Both sides dedupe by digest: gero-sync may redeliver anything.

---

## 7. gero-sync API

### 7.1 Common rules

- Base: the notify API, `https://sync.gerowallet.io/api/notify/v1`. Every route below is
  **signed exactly like `PUT /device`** (`RequestAuthenticator`): headers `X-Gero-Device`,
  `X-Gero-Ts`, `X-Gero-Nonce`, `X-Gero-Sig` over
  `gero-notify/v1|METHOD|PATH|TS|NONCE|sha256(body)`, the same order of checks, the same nonce
  store, the same per-IP and per-device limits. No query strings (`query_not_allowed`).
- The caller must be a registered device (`device_unknown` otherwise).
- JSON bodies, `Content-Type: application/json`, at most 16 KiB (`body_too_large`); unknown body
  fields are refused (`invalid_field`). Every success body carries `serverTime` (ms).
- Hex is lowercase; base64url as in 2.2. A path parameter that is not the right hex is
  `not_found`.
- Error envelope and existing codes as in the notify contract (`{ error: { code, message?, details? } }`).

New error codes:

| HTTP | code | When |
|---|---|---|
| 403 | `forbidden` | an owner-only route on a setup that exists and belongs to another device (only reachable by someone who already holds the random `setupId`) |
| 404 | `not_found` | unknown setup, invitation or link, or a caller that is not a recipient of that invitation (indistinguishable on purpose) |
| 409 | `setup_exists` | `POST /vault-setups` with a `setupId` owned by another device, or the same id with other values |
| 409 | `already_answered` | an invitation already accepted or declined, or a link already used |
| 410 | `expired` | the setup, invitation or link has expired |
| 410 | `revoked` | the invitation was revoked or the setup deleted; for an invitation, `details.revoke` is the REVOKE (base64url) when the initiator published one |
| 422 | `too_many_pending` | the device already owns 10 open setups; `details = { limit: 10, open: [{ setupId, expiresAt }] }` (the device's own setups, so the UI can offer Cancel) |
| 422 | `limit_exceeded` | per-setup caps; `details.limit` is `invitesPerSetup` (19) or `linksPerSetup` (20) |
| 429 | `rate_limited` | any rate limit in 7.6, with `Retry-After` |

### 7.2 Shared JSON shapes

```
Wrap      = { "slot": 0..4, "recipientKey": hex32, "ephemeralKey": hex32, "nonce": hex24, "wrappedKey": hex48 }
Sealed    = { "wraps": [Wrap…], "nonce": hex24, "ciphertext": base64url }
Delivery  = { "wrap": Wrap, "nonce": hex24, "ciphertext": base64url }
```

(`hexN` = 2N lowercase hex characters.) The server checks shapes and sizes only; it never
decrypts.

### 7.3 `PUT /device` (changed)

Body gains `"inviteKey": hex32` (optional). Present: stored, after the usable-key check of 3.1
(`invalid_field`, `details.field = "inviteKey"`). Absent: the device has no invite key and is never
a directory entry. `caps` gains `"vault_invites"`: vault pushes go only to devices that declare it
(as `announcements`). `DeviceView` echoes `"inviteKey": hex32 | null`.

The relay key signs the request, so the binding device ↔ invite key is as strong as the device
registration. Other parties learn invite keys only through gero-sync, which is untrusted anyway
(8.1).

### 7.4 `POST /vault-invites/recipients`: the directory

Request: `{ "network": text, "stakeCredential": hex28 }`

Response 200, for **any** well-formed request:

```
{ "network": text, "stakeCredential": hex28,
  "entries": [ { "slot": 0, "inviteKey": hex32 }, … exactly 5, slots 0..4 in order ],
  "serverTime": ms }
```

- Real entries: devices with a **verified** wallet link (`WalletControlProof`) to that network and
  stake credential, a current `inviteKey` and the `vault_invites` cap, that have not blocked the
  caller (7.5.9). Newest link first, ties by `deviceId`; at most 5. They take slots 0..k−1.
- Slots k..4: decoys (3.4).
- Same status, shape, size and work for every credential: compute all five decoys on every
  request and only then substitute real keys; no early return, no cache that only real
  credentials hit.

### 7.5 Routes

All owner-only routes answer `forbidden` to another device. `{setupId}` is hex16,
`{inviteId}` hex16 (server-random), `{joinTokenHash}` hex32.

1. **`POST /vault-setups`**, body `{ "setupId": hex16, "network": text, "expiresAt": ms }`.
   `expiresAt` in `(now, now + 7 d + 5 min]` else `invalid_field`. 201 `SetupView`
   `{ setupId, network, state: "open", createdAt, expiresAt, serverTime }`; the same request
   again by the same device is 200 with the same view; otherwise `setup_exists`. At most 10 open
   setups per device (`too_many_pending`).

2. **`POST /vault-setups/{setupId}/invites`** (owner), body
   `{ "stakeCredential": hex28, "wraps": [5 × Wrap], "nonce": hex24, "ciphertext": base64url ≤ 6160 bytes decoded }`.
   Exactly 5 wraps, slots 0..4 once each. **202 always**
   `{ "inviteId": hex16, "expiresAt": ms, "serverTime": ms }`, whether or not any device matches,
   with comparable timing (store first, fan out asynchronously). Delivery: every device that has a
   verified link to (setup network, credential), whose current `inviteKey` equals some wrap's
   `recipientKey`, that has the cap and has not blocked the sender, gets that wrap and a push.
   The server never refuses or reorders a wrap because a `recipientKey` is not current (that would
   tell the sender which slots are real). A second invitation to the same credential in the same
   setup replaces the open one (old state `replaced`). At most 19 open invitations per setup.

3. **`POST /vault-setups/{setupId}/invites/{inviteId}/remind`** (owner), empty JSON object
   `{}`. 202 `{ serverTime }`; re-pushes to the current recipients; at most once per 6 h per
   invitation (`rate_limited`).

4. **`POST /vault-setups/{setupId}/invites/{inviteId}/revoke`** (owner), body
   `{ "revoke": base64url ≤ 128 bytes decoded }`. 200 `{ inviteId, state: "revoked", serverTime }`.
   Stores the REVOKE opaque (it is checked by the cosigner, not the server), deletes the
   ciphertext after the grace (7.7). Revoking an answered invitation is `already_answered`.

5. **`PUT /vault-setups/{setupId}/links/{joinTokenHash}`** (owner), body
   `{ "nonce": hex24, "ciphertext": base64url ≤ 6160 bytes decoded, "expiresAt": ms ≤ setup's }`.
   201 new / 200 same `{ joinTokenHash, state: "open", expiresAt, serverTime }`. At most 20 open
   links per setup.

6. **`DELETE /vault-setups/{setupId}/links/{joinTokenHash}`** (owner). 204. Withdrawn.

7. **`GET /vault-invites`**. 200 `{ "invites": [InviteView…], "serverTime" }`, newest first, at
   most 50:
   ```
   InviteView = { inviteId, setupId, network, stakeCredential,
                  state: "open" | "accepted" | "declined" | "revoked" | "expired" | "replaced",
                  createdAt, expiresAt, ? answeredAt, ? answeredHere: bool,
                  ? delivery: Delivery,          // state "open" only: this device's own wrap
                  ? revoke: base64url }          // state "revoked", when published
   ```
   Lists invitations to credentials this device has a verified link to **now** and holds a wrap
   for; a device whose link was deleted sees nothing more. Closed ones stay listed 7 days after
   closing, without ciphertext, so another device can say "already accepted".

8. **`POST /vault-invites/by-link`**, body `{ "joinToken": hex32 }`. 200
   `{ setupId, network, expiresAt, nonce, ciphertext, serverTime }` (the link copy). `not_found`
   (unknown or withdrawn), `already_answered` (used), `expired`, `revoked` (setup deleted). The
   server compares `SHA-256(joinToken)` with stored hashes in constant time and never stores or
   logs the token.

9. **`POST /vault-invites/{inviteId}/block`** (a recipient device), `{}`. 204. Blocks the sending
   device for the credential(s) this device received the invitation under, for 90 days: its
   directory lookups get decoys there, and its later invitations are accepted (202) and dropped.

10. **`POST /vault-setups/{setupId}/responses`**, body
    `{ "kind": "accept" | "decline", ? "inviteId": hex16, ? "joinToken": hex32, "wraps": [1 × Wrap], "nonce": hex24, "ciphertext": base64url }`.
    Exactly one of `inviteId` / `joinToken`. The one wrap is slot 0 and its `recipientKey` must be
    the owner device's current `inviteKey` (`invalid_field`). Ciphertext ≤ 3088 bytes decoded for
    accept, ≤ 144 for decline.
    - With `inviteId`: the caller must be a current recipient (else `not_found`); the invitation
      must be open (`already_answered`, `expired`, `revoked`).
    - With `joinToken`: it must hash to an open link of this setup (`not_found`,
      `already_answered`, `expired`); the link becomes `used`.
    202 `{ "responseId": hex16, "serverTime" }`; push `vault_response` to the owner device.

11. **`GET /vault-setups/{setupId}/responses`** (owner). 200
    ```
    { setupId, network, state: "open" | "closed" | "expired", expiresAt,
      invites:   [ { inviteId, stakeCredential, state, createdAt, ? answeredAt } ],
      links:     [ { joinTokenHash, state: "open" | "used" | "withdrawn" | "expired", expiresAt } ],
      responses: [ { responseId, kind, ? inviteId, ? joinTokenHash, receivedAt, delivery: Delivery } ],
      serverTime }
    ```

12. **`DELETE /vault-setups/{setupId}`** (owner). 204. Closes the setup (the vault was created, or
    the initiator cancelled): open invitations become `revoked` (with no REVOKE unless route 4 ran
    first), open links `withdrawn`, the setup stops counting toward the 10.

### 7.6 Rate limits (initial values, server configuration)

| Scope | Limit |
|---|---|
| directory lookups per device | 60 / hour, 300 / day |
| invitations created per device | 30 / hour |
| invitations to one (network, credential), all senders | 20 / day |
| invitations to one (network, credential) from one device | 3 / day |
| remind | 1 per invitation per 6 hours |
| `by-link` per device | 30 / hour |
| responses per device | 30 / hour |
| `GET /vault-invites`, `GET …/responses` per device | 120 / hour |

The per-credential limits answer `rate_limited` whatever the credential: they count invitations,
not devices, so they reveal nothing.

### 7.7 Retention

| Data | Deleted |
|---|---|
| invitation ciphertext and wraps | at accept, decline, revoke, replace or setup delete + **10 min** grace; at expiry |
| link ciphertext | at use or withdrawal + 10 min; at expiry |
| response ciphertext | setup delete + 24 h, or setup expiry + 24 h |
| metadata (states, times, credential, device ids, REVOKE, join token hashes) | setup expiry or delete + 7 days |
| blocks | 90 days |

Never logged in any form: ciphertexts, wraps, join tokens, REVOKE payloads. Invite keys and stake
credentials only at debug level and only hashed.

### 7.8 Push

Category **`vault_invite`**, on by default, switchable per device. Two types:

| `t` | To | When |
|---|---|---|
| `vault_invite` | each matching recipient device | invitation created, reminded |
| `vault_response` | the setup's owner device | a response filed |

Payload: the standard envelope keys every notify push carries (`v`, `c = "vault_invite"`, `e`,
`ts`, `exp`, `d = "vault"`) plus **only** `t` and `setupId` (hex16). No `w`, no text, no amounts,
no inviter. `e = hex(SHA-256(t + "|" + setupId))[0:32]` (collapse per setup); `exp` = the
invitation's expiry. APNs: `mutable-content: 1` and the generic `PUSH_VAULT_INVITE_*` /
`PUSH_VAULT_RESPONSE_*` loc keys; FCM: a data message; Web Push: the encrypted JSON. Clients fetch
and decrypt before showing text ("Adam invited you to co-sign Ops petty cash"), else the generic
line ("You have a vault invitation").

---

## 8. Threat notes

### 8.1 gero-sync and the directory are untrusted

- gero-sync can drop, delay, reorder, replay and misattribute anything. It cannot read a payload
  sealed to a real device key, forge an INVITE or ACCEPT (attested by vault payment keys), forge a
  DECLINE (needs the inviteDigest) or a REVOKE before it is published (needs the revoke secret),
  or forge a link-path ACCEPT (needs the MAC key, which never leaves devices).
- **An active gero-sync can man-in-the-middle a remote invitation**: it answers the directory with
  its own keys, reads the invitation, and can present the cosigner a different vault signed by a
  key it controls, or the initiator a different "cosigner". This is why the **GV-61 ceremony is
  the trust anchor**: the 40-digit number covers every participant's vault keys, so a substituted
  key is caught before funding (#1729, adversarial tests in #1772 / #1773). Confidentiality
  against gero-sync holds only while gero-sync is honest-but-curious.
- Labels, handles and stake credentials inside an invitation are self-declared by the inviter.
  Only "known contact or shared vault" moves an invitation from Requests to Needs you, and that is
  decided on the device.

### 8.2 What gero-sync sees

Device ids and invite keys; for each setup: owner device, network, `setupId`, times, the recipient
stake credentials, which devices fetched what and when, sizes, join token hashes (and a token when
presented), REVOKE payloads, response kinds (accept/decline). Never: vault names, labels,
participants, vault keys, digests, the capability, the content or MAC keys.

### 8.3 Decoys and enumeration

The directory always answers 5 well-formed keys, so a sender cannot tell whether a credential has
Gero devices, and the invitation answer (202) and timing are the same. Residual leaks, accepted
for this round:

- **Change over time.** Decoys are stable per (network, credential, slot); real entries change
  when a device links, unlinks or rotates its key. A sender who queries the same credential
  repeatedly can see a change and infer real devices. Rate limits bound this; rotating the decoy
  secret changes every credential at once and hides nothing.
- **Answers.** An ACCEPT or DECLINE proves a device read the invitation. A sender learns nothing
  from silence.
- **Timing.** Mitigated by constant work (7.4) and asynchronous fan-out (7.5.2); gero-sync tests
  compare timings (GV-86 acceptance).

### 8.4 Links

- A link or QR is a bearer capability: whoever holds it can fetch the copy and answer once. The
  MAC proves the answer came from a holder of that capability, not who they are; a forwarded link
  can be used by the wrong person, which the number ceremony catches (that person cannot read the
  right key set back on a call with the initiator).
- The fragment does not reach gerowallet.io; the join token reaches gero-sync only when presented,
  and only its hash is stored.

### 8.5 Keys at rest and forward secrecy

The device invite secret is static: whoever later steals it can open stored invitations sealed to
it. Ciphertexts are therefore deleted early (7.7), and the invitation carries nothing that lets a
reader spend: only vault public keys, which go into the manifest anyway. Wraps use a fresh
ephemeral per recipient. Responses are sealed to the initiator's static key under the same rule.

### 8.6 Replay

Every AAD, HKDF info and digest names `setupId` and the KIND; the wrap key also binds the slot and
both public keys. A replayed invitation or response is a duplicate (dedupe by digest). An ACCEPT
names the exact invitation (digest) and its terms (vault name, threshold, owners), so it cannot be
moved to another setup or to changed terms.

---

## 9. Test vectors

`__fixtures__/invite-vectors.json`, checked by `inviteVectors.spec.ts`:

- `deviceKeys`, `decoys`, `directory`: X25519 keys, three server decoys and the 5-slot directory.
- `invite`: the body (readable and CBOR), digest, CIP-8 and expired-transaction signed forms, and
  the full 5-slot seal with per-wrap intermediates (`ephemeralKey`, `sharedSecret`, `wrapKey`,
  `wrapAad`) so a port can locate ECDH vs HKDF vs AEAD faults.
- `link`: fields, QR payload, URL, CBOR, `joinToken`, `joinTokenHash`, `contentKey`, `macKey`, and
  the link copy (body, digest, signed CBOR, sealed).
- `accept` (both signature methods, sealed), `linkAccept` (with MAC), `decline`, `revoke`.
- `negative`: 61 inputs every reader must refuse, each with its `target` and refusal `code`
  (targets: `link`, `signedInvite`, `signedAccept`, `delivery`, `revoke`, `x25519`, `base64url`;
  the spec's switch shows the exact call for each).

Every secret is `BLAKE2b-256("gero-vault-invite vectors|<label>")`; the vault keys are the manifest
specs' test participants. The spec also re-derives every sealed object from the file alone with
libsodium and a hand-written HKDF over HMAC-SHA256, independent of this module's code.
Regenerate only after a deliberate contract change:
`WRITE_INVITE_VECTORS=1 npx vitest run src/shared/gerovault/invite/inviteVectors.spec.ts`.

---

## 10. Open questions

1. **GV-61 amendment 2** (#1771): whether an in-person scan verifies. Undecided; this round it
   does not (section 5).
2. **"Already accepted on another device: name that device"** (GV-85 edge states): gero-sync has
   no device names. Proposal: `answeredHere` only, and the UI says "on another of your devices".
3. **Setup state relay** (`VAULT_SETUP_STATE`, the final verification digest to all members):
   needs the durable vault store (GV-05, #1673); not in this contract.
4. **Hardware wallets**: both attestation methods are allowed; which devices can sign an
   invitation or acceptance waits on GV-06 (#1674).
5. **Directory change leak** (8.3): accept, or have devices rotate invite keys on a schedule
   (costs lost invitations), or answer stale-looking directories for unchanged ones. Needs a
   decision with the #1731 threat-model review.
6. **Backup template**: invitations carry `template: "standard"` only.
