# cNIGHT → DUST Generation: Official Portal Research + In-Wallet Build Plan

**Date:** 2026-07-14
**Goal:** Build the "generate DUST from cNIGHT I hold in my Cardano wallets" experience natively inside Gero, replacing the current link-out to the external portal.

---

## 1. What the official portal is

Midnight ships a Nethermind-built, non-custodial web dApp ("DUST Generator") that links the Cardano wallet holding your NIGHT (cNIGHT, a Cardano native asset) to a DUST address on Midnight:

| Network | URL |
|---|---|
| Mainnet | `https://midnight-dust-mainnet.nethermind.io/` |
| Preview | `https://dust.preview.midnight.network/` |

> Note: [DustRegistrationDialog.vue:430-432](../../src/modules/dashboard/dialogs/DustRegistrationDialog.vue) currently sends mainnet users to `https://redeem.midnight.gd/` (the Glacier Drop claim portal), **not** the DUST mapping portal. Wrong link even for the interim state.

**Portal UX (observed live 2026-07-14):**
1. Connect a CIP-30 Cardano wallet ("Supported wallets include Lace, Nami, Eternl, Flint, Typhon, NuFi, **GeroWallet**, and CCVault" — we are on the official list).
2. Provide a Midnight DUST address (optionally by connecting a Midnight wallet, e.g. Lace-Midnight).
3. Sign one Cardano transaction that creates the mapping. Portal actions: **register**, **update DUST address** (single tx), **deregister**.
4. Status surface: Pending → Registered (relay takes ~432 Midnight blocks ≈ 2.5 h; generation visible ≤ 12 h).

**Official FAQ facts (harvested from the live portal):**
- Requirements: CIP-30 wallet, NIGHT tokens + "enough ADA for a Cardano transaction", valid Midnight DUST address.
- Free apart from the Cardano network fee (register / re-register / deregister all cost one Cardano tx).
- One DUST address per wallet's NIGHT balance ("Can I designate DUST to multiple wallets? No.").
- DUST designation can be changed at any time.
- Cap 5 DUST per NIGHT; ≥ 12 h before DUST shows in the Midnight wallet.
- Moving NIGHT out → corresponding DUST decays down to the cap of what remains; deregistering → decays to zero.

## 2. On-chain mechanics (as the official portal actually builds them)

Verified by de-minifying the portal's tx-builder chunk (`921.13918886e284b430.js`, Lucid-based) on 2026-07-14:

**Register (`buildRegistrationTransaction`):**
```js
i = getAddressDetails(walletAddress)?.stakeCredential?.hash   // ← STAKE key hash, hard requirement
datum   = { c_wallet: { VerificationKey: [i] }, dust_address: DUST_PKH }   // Constr 0 [Constr 0 [vkh], bytes]
redeemer = "Create"                                            // Constr 0 []
tx.mintAssets({ [policyId + ""]: 1n }, redeemer)               // 1 NFT, EMPTY asset name, policy = validator hash
tx.pay.ToContract(validatorAddress, { kind: "inline", value: datum }, { lovelace: minAda, [nft]: 1n })
tx.addSigner(paymentAddress)                                   // payment key in requiredSigners
tx.addSigner(rewardAddress)                                    // stake key in requiredSigners ("Added stake address as signer")
```
- **Deregister:** consume the registration UTxO (spending validator) + burn the NFT; both payment and stake addresses added as signers.
- **Update:** consume + re-output with the new datum in one tx, plus a **withdrawal from the validator's reward account** for script authorization (`tx.withdraw(scriptRewardAddr, withdrawable, void)` + WithdrawalValidator attached).
- Validator: `cnight_generates_dust.ak` from `midnightntwrk/midnight-reserve-contracts` (multi-purpose: mint policy + spend + withdraw). Script hashes (pinned in Nexus `application.yml`, verified against blueprints):
  - Preview/Preprod: `7e69087d98fac5869eac14e13dfb6f98228c41e638aa2a59d1f85e9c`
  - Mainnet: `73e4aea31b5b51d9b0ca386196fc6a4c422f74c5aea011e4b8bdf4e5`
- `dust_address` is the **DUST public key bytes** (≤ 33 bytes), not the bech32m string.

**Consistent corroboration that the registered credential is the stake credential:**
- Portal datum decoder names the field `stakeKeyHash` and matches existing registrations against the connected wallet's `stakeCredential.hash`.
- Midnight indexer's official query is `dustGenerationStatus(cardanoRewardAddresses: [String!]!)` — keyed on reward addresses.
- docs.midnight.network/concepts/dust-architecture: users register "their Cardano reward address + DUST public key on Cardano".

## 3. 🔴 Critical finding: Nexus registers the WRONG credential

Nexus's `/api/midnight/{network}/dust/build-registration-tx` is fully implemented (returns `status='complete'` ready-to-sign CBOR) **but puts the payment key hash in the datum**:

- `MidnightDustRegistrationTxBuilder.java:80` — `datumCodec.buildVerificationKeyDatum(paymentKeyHash, dustAddress)`
- `MidnightDustTxAssembler.java:270` — `requiredSigners(List.of(paymentKeyHashBytes))` (payment key only)
- Yet Nexus's own status endpoints (`/dust/status`, `/dust/status/batch`) query the Midnight indexer **by reward address** (`stake1…` regex-enforced).

A registration built by Nexus today anchors to the payment credential. The observation layer / indexer keys on the stake credential, so DUST generation would (very likely) never start, and our own status endpoint could never see the registration it built. **This must be fixed in Nexus before any in-wallet Path B ships.** Fix shape: accept the stake key hash (rename field or add `credentialType`), cross-check it against the address's delegation part, put it in the datum, and add it to `requiredSigners` (keep the payment key too — it authorizes the spend of the fee inputs, matching the portal which adds both).

## 4. Current state in Gero

| Piece | State |
|---|---|
| Path A (register the wallet's own Midnight-side NIGHT) | ✅ Shipped — primary action in `DustRegistrationDialog.vue`, single BG round-trip, works E2E |
| Path B wallet API client | ✅ Ready — `midnight-api.ts` `buildDustRegistrationTx()`, `getDustStatus[Batch]()`, `getDustAccountState()` |
| DUST-address → hex helper | ✅ Ready — `midnightKeyManager.ts` `dustAddressToHex()` written specifically for this endpoint |
| Nexus build endpoint | ⚠️ Implemented but registers payment credential (see §3) |
| Nexus deregister / update endpoints | ❌ Not implemented (register/Create only) |
| Path B UI | ❌ Link-out only, and the mainnet link points at the wrong portal |
| cNIGHT balance detection on Cardano side | Generic token list only; no dedicated "your cNIGHT can generate DUST" surface |

## 5. Proposed in-wallet experience

Gero's structural advantage over the portal: **the Cardano wallet and the Midnight DUST address live in the same wallet (same mnemonic).** The portal needs two wallet connections; we need zero — no CIP-30 connect, no address copy-paste, no external site.

**Flow (dashboard + mini-gero):**
1. **Discover:** on the Midnight dashboard (and/or Cardano token row for NIGHT), show a card when any of the wallet's Cardano accounts hold cNIGHT and their stake credential is unregistered: "Your X NIGHT on Cardano can generate ~5X DUST. Register once, free (network fee only)."
2. **Review:** one sheet showing: Cardano account (stake credential) → arrow → the wallet's own DUST address (pre-filled, `addresses.dust`); fee + min-ADA note; the 2.5 h relay + ≤ 12 h start expectations (reuse the existing 3-stop flow diagram).
3. **Sign:** spending password / PassKey — background signs with **payment + stake keys** (we already sign stake certs for staking, same machinery). Submit through the standard Cardano submit path.
4. **Track:** status chip Pending → Registered via `getDustStatus(stakeAddress)` polling; then reuse the existing DUST gauge/battery for live generation.
5. **Manage (later):** change DUST address (update tx incl. validator withdrawal auth), deregister (burn), with the "moving NIGHT decays DUST" warnings we already have copy for.

**Build plan — implementation status (2026-07-14):**
- **Phase 0 (Nexus)** ✅ nexus PR #687: datum keyed to the stake credential (derived server-side), requiredSigners = payment + stake, payment hash optional, script-credential guards.
- **Phase 1 (wallet)** ✅ committed on `midnight-continued` (31f36f8a): `useCnightDustRegistration` composable (portal-verified cNIGHT policy ids per network), `CnightDustRegistrationDialog`, PortfolioPage banner with status-aware CTA, one-gesture password/PassKey sign via SIGN_TX/SUBMIT_TX, hardware-wallet fallback to the official portal, mainnet portal link fixed.
- **Phase 2 (both)** ✅ same PR/branch: register/deregister/update all rotate the wallet's cNIGHT UTxOs (portal parity — generation covers the existing balance); Nexus `build-deregistration-tx` (spend + burn) and `build-update-tx` (spend + re-output + validator-reward-account withdrawal auth); wallet manage actions "Stop generating DUST" and "Move DUST destination to this wallet" in the dialog.
- **Deferred:** mini-gero (sidepanel) parity surface, multi-account sweep (batch status endpoint exists, max 50), unregistered-cNIGHT notification badge, live E2E on **preprod** (our test env; preview is not provisioned). Preprod facts verified on-chain 2026-07-14: cNIGHT asset live (policy `d2dbff62…`, empty name, ~100M supply, 203 mints), validator address `addr_test1wplxjzranravtp574s2wz00md7vz9rzpucu252je68u9a8qzjheng` holds 42 registration UTxOs (pipeline operational). No preprod portal instance exists — the in-wallet flow is the only preprod UI (portal CTA hidden there).

## 6. Open questions
- Min-ADA locked at the validator UTxO: portal uses a constant (`s.ks`, unresolved from the minified bundle); Nexus computes its own — confirm the value on preview and surface it in the UI copy.
- Whether the observation layer *also* honors payment-credential registrations (would soften §3 from "broken" to "non-standard") — testable on preview with one Nexus-built registration; do this before rewriting, but the stake-credential fix is the right shape either way since the portal, docs, and indexer all agree.
- Preview portal assumed identical to mainnet (same Nethermind app); spot-check when testing on preview.

**Sources:** live portal bundle inspection (2026-07-14); [docs.midnight.network/concepts/dust-architecture](https://docs.midnight.network/concepts/dust-architecture); `midnightntwrk/midnight-reserve-contracts` spec; Midnight Preview Partners Guide pp. 10–13; Nexus `MidnightDustRegistrationTxBuilder` / `MidnightDustTxAssembler` / `MidnightDustController`; gerowallet `midnight-api.ts`, `midnightKeyManager.ts`, `DustRegistrationDialog.vue`.
