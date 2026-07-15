# Midnight tx-build refactor — asymmetric split (unshielded via Nexus, shielded in wallet)

**Status:** Plan, ready to execute.
**Date:** 2026-05-26
**Supersedes (partially):** [2026-05-05-midnight-tx-build.md](2026-05-05-midnight-tx-build.md) — same three-tier shape, but the wallet/Nexus boundary moves per-flow.
**Pairs with (Nexus side):** to be written under `nexus/docs/superpowers/plans/`.

---

## 1. The decision

Split tx-building responsibility by privacy class:

| Step                              | Unshielded NIGHT | Shielded NIGHT (future)   |
| --------------------------------- | ---------------- | ------------------------- |
| Sync NIGHT/note state             | Nexus            | **Wallet** (notes encrypted) |
| Build tx (inputs + outputs)       | **Nexus**        | **Wallet**                |
| DUST fee balance                  | Wallet           | Wallet                    |
| Sign segments                     | Wallet           | Wallet                    |
| ZK prove + bind + submit          | Nexus            | Nexus                     |

The dust secret and Zswap secret are the only constraints that force work onto the wallet. Anything that doesn't need them belongs on Nexus.

For **unshielded**, NIGHT UTxOs are public — Nexus's indexer-backed view is canonical, and putting selection/change-calc on the wallet just duplicates state. Move it to Nexus.

For **shielded**, notes are encrypted to the user's Zswap encryption key. The wallet is the only party that can see its own notes. The whole pre-proving pipeline stays in the wallet.

## 2. Why we're doing this now

The flow shipped on 2026-05-26 (BG-builds-unshielded, sidecar prove+submit) works but loads the wallet with two SDK syncs (UnshieldedWallet + DustWallet) per cold send — ~5-30s and ~5-15s respectively. We can drop the UnshieldedWallet sync entirely by moving its work to Nexus. The DustWallet sync remains until we adopt the lower-level `DustLocalState.spend()` primitive (see §6, follow-up).

Shielded was never on the table for "build in Nexus" — but spelling out the asymmetry now means we don't accidentally design ourselves into a corner where shielded needs to dust-balance differently from unshielded.

## 3. Non-goals

- No new flow for shielded in this plan. Shielded keeps the BG-builds shape that's already proven by today's unshielded deploy.
- No change to the sidecar `/tx/finalize` shape. `{network, signedTxHex}` → prove + bind + submit is correct for both unshielded and shielded.
- No change to the Java `SidecarFinalizeRequest`. Already trimmed to forward `signedTxHex` + return `txHash`.
- No state persistence in this plan. That's a separate follow-up (Lace-style throttled `serializeState()` to IndexedDB).

## 4. New wallet-side flow for unshielded NIGHT transfer

```
┌────────────┐  POST /tx/build-unshielded  ┌──────────────┐
│  Wallet    │ ────────────────────────────▶│  Nexus       │
│  (BG SW)   │ ◀────────────────────────────│  /api/v1/…   │
│            │  {unprovenTxHex, segments}   │              │
│            │                              │              │
│            │  ─── BG-local ────────────────              │
│            │   1. DustWallet sync                        │
│            │   2. balanceTransactions(dustSk, …)         │
│            │   3. signSegment per input                  │
│            │   4. serialize → signedTxHex                │
│            │                              │              │
│            │  POST /tx/submit             │              │
│            │ ────────────────────────────▶│              │
│            │  {signedTxHex}               │              │
│            │ ◀────────────────────────────│              │
│            │  {txHash, status:Submitted}  │              │
└────────────┘                              └──────────────┘
```

Two network round-trips (build + submit), one BG-local pipeline (dust + sign).

## 5. What changes — concrete

### 5.1 Nexus sidecar (`nexus/sidecar/`)

**No changes required.** Current state:

- `/tx/build-unshielded` already returns NIGHT-only unproven tx + per-input segments-to-sign (`buildUnshieldedTransferTx` in `src/sdk/unshieldedTransfer.ts:104` is correct as-is — no dust balancing happens at build time).
- `/tx/finalize` already takes `{network, signedTxHex}` → prove + bind + submit (simplified 2026-05-26 in commit `ba5ea92` → `d62d235` on `midnight-bg-tx-build`).

### 5.2 Nexus Java (`nexus/src/main/java/…/midnight/`)

**No changes required.** `MidnightTransactionsController.buildUnshielded` already exists and proxies to the sidecar. `MidnightTxSubmitService` already forwards `signedTxHex` to `/tx/finalize`. Both were left intact through the BG-builds detour.

### 5.3 Wallet — service layer (`src/services/midnight-tx.service.ts`)

Revert the single-round-trip `sendUnshieldedNight` rewrite (commit `1b547dad` on `midnight-preview`) to a four-step orchestration:

```typescript
export async function sendUnshieldedNight(
  network: string,
  baseRequest: Omit<BuildMidnightTxRequest, 'publicKeyHex' | 'addressHex'>,
  credentials: MidnightSendCredentials,
): Promise<SubmitMidnightTxResponse> {
  // 1. Get keys (fast path or one-shot mnemonic decrypt).
  const { publicKeyHex, addressHex } = await getWalletKeys(credentials);

  // 2. Nexus builds unproven NIGHT tx + segments-to-sign.
  const built = await buildUnshielded(network, {
    ...baseRequest,
    publicKeyHex,
    addressHex,
  });

  // 3. BG: DUST-balance + sign each input + serialize.
  const signedTxHex = await balanceAndSignInBg(
    network,
    built.unprovenTxHex,
    built.segmentsToSign,
    baseRequest.ttlMs,
    credentials,
  );

  // 4. Nexus relays signedTxHex → sidecar /tx/finalize → prove + submit.
  return submitSignedTx(network, signedTxHex);
}
```

- `getWalletKeys`, `buildUnshielded`, and `submitSignedTx` already exist — restore their use here.
- `balanceAndSignInBg` is the new BG round-trip (see §5.4).
- Remove the temporary `buildAndSignUnshieldedTxInBg` helper (no callers after this refactor; the BG handler it called gets replaced).

### 5.4 Wallet — BG handler (`src/chrome/background.ts` + `src/chrome/walletBg.ts`)

Replace the temporary `BUILD_AND_SIGN_MIDNIGHT_UNSHIELDED_TX` BG path with `BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX`. New shape:

**Request:** `{ unprovenTxHex, segments: SegmentToSign[], ttlMs, password?, prfSecret? }`

**Response:** `{ success: true, signedTxHex }` (hex of the signed-but-unproven tx with markers `signature/pre-proof/pre-binding`).

**BG implementation (`walletBg.ts`):**

```typescript
async balanceAndSignMidnightUnshieldedTransfer(
  unprovenTxHex: string,
  segments: MidnightSegmentToSign[],
  ttlMs: number,
  password?: string,
  prfSecret?: Uint8Array,
): Promise<string> {
  // … decrypt mnemonic (PRF or password), same pattern as today …
  const derived = await deriveMidnightKeys(mnemonic, this.network, 0, { skipCardano: true });
  try {
    return await balanceAndSignUnshieldedTransfer({
      sdkNetworkId,
      endpoints,
      unshieldedSecretKey: derived.unshieldedSecretKey,  // for signSegment
      dustSecretSeed: derived.dustSecretKey,             // for balanceTransactions
      unprovenTxHex,
      segments,                                          // server-told segment shapes
      ttl: new Date(ttlMs),
    });
  } finally {
    derived.unshieldedSecretKey.fill(0);
    derived.dustSecretKey.fill(0);
    derived.seed.fill(0);
  }
}
```

The keystore is constructed from `unshieldedSecretKey` (same as today). DustWallet is constructed and synced (same as today). The change vs. today: instead of `unshieldedWallet.transferTransaction(…)` to build the tx, we **deserialize** the unproven tx Nexus gave us:

```typescript
const TxAny = ledger.Transaction as unknown as {
  deserialize: (s: string, p: string, b: string, raw: Uint8Array) => ledger.UnprovenTransaction;
};
const unprovenTransfer = TxAny.deserialize(
  'no-signature', 'pre-proof', 'pre-binding',
  hexToBytes(unprovenTxHex),
);

// Then exactly as today:
const balancedTx = await dustWallet.balanceTransactions(dustSk, [unprovenTransfer], ttl);
const signedTx   = await unshieldedWallet.signUnprovenTransaction(balancedTx, signSegment);
```

Note: Nexus builds the tx with empty signatures (`UnshieldedOffer.new(inputs, outputs, [])`), so the marker triple coming off the wire is `no-signature/pre-proof/pre-binding`. The wallet's `signUnprovenTransaction` walks it to `signature/pre-proof/pre-binding`.

**Important:** the `UnshieldedWallet` instance is no longer needed for state sync — only for its `signUnprovenTransaction` walker over the deserialized tx. Verify whether we can call that walker without `startWithPublicKey + waitForSyncedState`. If not, we still need a stub wallet but can skip the `waitForSyncedState` call (saving the 5-30s).

### 5.5 Wallet — MessageTypes (`src/models/MessageTypes.ts`)

- Delete `BUILD_AND_SIGN_MIDNIGHT_UNSHIELDED_TX`.
- Add `BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX` with the new request shape.
- Restore the comment block on `SIGN_MIDNIGHT_SEGMENTS` to reflect that it's now used by DUST registration only (the unshielded path uses the combined balance+sign handler).

### 5.6 Wallet — tx builder lib (`src/chains/midnight/midnightTxBuilder.ts`)

Rename `buildAndSignUnshieldedTransfer` → `balanceAndSignUnshieldedTransfer`. Same internal SDK loading, same key-wipe finally block. Two changes:

- Drop the `outputs: UnshieldedTransferOutput[]` arg.
- Drop the `unshieldedWallet.transferTransaction(…)` call.
- Add `unprovenTxHex: string` + `segments: MidnightSegmentToSign[]` args.
- Add the deserialization step above.

If §5.4's stub-wallet investigation finds we can't bypass the UnshieldedWallet sync, the function stays largely the same shape internally; only the entry point changes.

## 6. Open question — DustWallet sync cost

`dustWallet.balanceTransactions` reads spendable DUST UTxOs from `DustWallet.state`, which only populates after a live indexer sync (~5-15s cold). This is the remaining wallet-side cold-start cost after this refactor.

Two follow-up options, **out of scope for this plan**:

1. **State persistence** — Lace pattern: throttle `dustWallet.serializeState()` to IndexedDB every ~5s, restore on SW wakeup. Warm sync drops to sub-second. Already on the backlog.
2. **Lower-level primitive** — bypass DustWallet entirely. Nexus tells the wallet the user's DUST UTxOs + the fee amount; wallet calls `ledger.DustLocalState.spend(dustSk, utxo, fee, t)` directly and assembles the `DustActions` manually. No DustWallet sync at all. Needs a half-day spike to verify the wire format + fee-math reproducibility outside the SDK.

The plan in this doc lands with the simpler "DustWallet sync stays in BG" model. Either follow-up can layer on top without re-architecting.

## 7. Execution order & estimated effort

All estimates assume one engineer, no surprises.

1. **Sidecar smoke test** (15 min) — confirm `/tx/build-unshielded` still works on the deployed image. Already deployed, no code change needed; just a `curl` against the dev cluster.
2. **Wallet — BG handler rename + signature change** (1 hr) — `BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX` handler in `background.ts`; `balanceAndSignMidnightUnshieldedTransfer` method in `walletBg.ts`; deserialize-then-balance-then-sign in `midnightTxBuilder.ts`. Verify whether we can skip `waitForSyncedState` on the UnshieldedWallet instance.
3. **Wallet — service layer revert** (30 min) — restore four-step `sendUnshieldedNight` in `midnight-tx.service.ts`.
4. **Wallet — MessageTypes cleanup** (10 min).
5. **Build + smoke test** (30 min) — `npm run build:background`, reload extension, send a tiny NIGHT transfer on preview.
6. **Commit + deploy** (30 min) — single wallet commit on `midnight-preview`; no Nexus deploy needed (sidecar + Java were already simplified and are forward-compatible).

**Total:** ~3 hr wallet-side, zero Nexus-side. Lower-risk than the original BG-builds change because the Nexus build path has been live and tested for weeks.

## 8. Rollback

If the new flow fails on preview after deploy:

- Wallet rollback: revert the single refactor commit on `midnight-preview`. The BG-builds-unshielded path returns. Already deployed and known-working.
- No Nexus rollback needed (no Nexus changes in this plan).
- The sidecar/Java simplifications stay regardless — they're correct under both architectures.

## 9. What this leaves on the table

- **Shielded send.** Untouched. Will use the BG-only pipeline pattern proven by today's deploy (build + balance + sign + ship-to-Nexus).
- **State persistence.** Separate plan. Reduces both UnshieldedWallet *and* DustWallet warm-sync times if either still applies (shielded sync, DustWallet for unshielded fee step).
- **NIGHT-for-DUST registration (Path A).** Unchanged. Still uses the existing first-time-registration flow which is fee-free.
- **Hardware wallet support.** Still impossible. Midnight needs the cleartext key at sign/prove time; HW wallets won't expose it. Documented in [2026-05-05-midnight-tx-build.md](2026-05-05-midnight-tx-build.md).
