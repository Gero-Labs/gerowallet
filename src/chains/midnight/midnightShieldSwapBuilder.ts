// BG-side build + sign for the SHIELD half of a shield/unshield conversion
// (public NIGHT -> private/shielded NIGHT).
//
// Unshield (private -> public) is deliberately NOT implemented in this file
// yet — ground rule 16 of docs/plans/2026-07-13-midnight-shield-unshield.md:
// no real shield has succeeded on-chain yet, so there is nothing to unshield
// to test against. Build order per that plan's section 3: shield first,
// human on-chain checkpoint, THEN unshield. See that plan's section 0 for
// the full SDK research this file is grounded in (installed package READMEs
// + ledger-v8 type declarations, not inference).
//
// Shield's two halves come from different places and get merged into one
// transaction:
//
//   - Unshielded half (spends existing public NIGHT UTxOs, returns change
//     only — no payment output): built server-side by Nexus's
//     `/tx/build-unshielded` in swap mode (WP-SH1), because coin selection
//     needs the indexer-backed UTxO view Nexus already has (this wallet's
//     local UnshieldedWallet instance is never synced with UTxO state — see
//     midnightTxBuilder.ts's file header). The wallet then signs it locally
//     with the NightExternal key via `signUnshieldedSegments` —
//     the EXACT same pipeline `midnightTxBuilder.ts` uses to sign a regular
//     unshielded send, reused here rather than forked.
//   - Shielded half (a brand-new shielded output, funded by the unshielded
//     side, no shielded inputs spent): built client-side via
//     `ShieldedWallet.initSwap(zswapKeys, {}, [output])` — the SDK's own
//     documented shield-swap primitive (plan section 0,
//     `wallet-sdk-shielded/dist/ShieldedWallet.d.ts:47`) — through the exact
//     same wallet startup/sync/restore pipeline `midnightShieldedBuilder.ts`
//     already uses for a plain shielded send (`startAndSyncShieldedWallet`),
//     reused here rather than forked.
//
// The two halves are combined with plain `ledger.Transaction.merge()`
// (`ledger-v8.d.ts:2418`), DUST fees are balanced ONCE against the combined
// tx (mirroring the SDK facade's own `initSwap` orchestration — plan
// section 0's `shieldedTx.merge(unshieldedTx); combined.merge(dustFeeTx)` —
// rather than balancing the unshielded half alone, which would under-fee
// the bigger final combined tx), and the result is optionally proven+bound
// locally before returning, via the exact same `proofServer` mode branch
// WP-P2 of the proof-server plan already built for plain shielded sends.
//
// No @midnightntwrk/wallet-sdk-facade or `effect` import, by design — hand-
// rolled from pieces Gero already has, same reasoning as the local-prover
// spike (docs/plans/2026-07-13-midnight-proof-server-setting.md ground
// rule 12).
//
// SEQUENCING NOTE (flag for the human on-chain checkpoint — plan section 3
// step 5): this file signs the unshielded half LAST — after merging it with
// the shielded half AND the DUST fee tx, right before proving — mirroring
// where `midnightTxBuilder.ts`'s OWN proven-working send flow signs (after
// its dust-fee merge), rather than the SDK facade's pseudocode order (where
// the unshielded side signs ITSELF as part of a client-side
// `unshielded.initSwap()` call this wallet does not make, since Nexus builds
// that half instead — Gero's `UnshieldedWallet` instance is never UTxO-
// synced, only sign-capable). This ordering is REASONED from the closest
// verified precedent in this codebase, not chain-verified — if the human
// checkpoint's first shield attempt fails signature validation, re-examine
// this ordering first.
//
// WP-SH1 has shipped on nexus's `development` branch. The request shape in
// `MidnightApi.buildShieldSwapUnshieldedTx` (midnight-api.ts) uses field
// names confirmed against a live `swapAmountValidForMode` validation error
// (`swapMode` + `swapAmount`), not just a guess at the plan's design.

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { MidnightNetworkEndpoints } from '@/chains/midnight/midnightConfig';
import { debugLog } from '@/utils/debug';
import { getMidnightApi } from '@/api/midnight-api';
import {
  NIGHT_RAW_TOKEN_TYPE,
  startAndSyncShieldedWallet,
} from '@/chains/midnight/midnightShieldedBuilder';
import type { BuildAndSignShieldedTransferResult } from '@/chains/midnight/midnightShieldedBuilder';
import {
  syncDustWalletAndBalanceFees,
  signUnshieldedSegments,
  hexToBytes,
} from '@/chains/midnight/midnightTxBuilder';

/** Mirrors {@link BuildAndSignShieldedTransferResult} — reused, not forked. */
export type BuildAndSignShieldResult = BuildAndSignShieldedTransferResult;

export interface BuildAndSignShieldArgs {
  /** SDK network ID — 'mainnet' / 'preview' / 'preprod' / 'testnet'. */
  readonly sdkNetworkId: string;
  /** Indexer + Nexus endpoints (the BG knows these via midnightConfig). Also carries the Gero `Network` slug ({@code endpoints.network}) used for `getMidnightApi`. */
  readonly endpoints: MidnightNetworkEndpoints;
  /** Amount of NIGHT (base units, 6 decimals) to move from the public pool into the shielded pool. */
  readonly amount: bigint;
  /** Sender's own unshielded `mn_addr_…` address — Nexus spends FROM here; change comes back here too. */
  readonly ownUnshieldedAddress: string;
  /** Raw signing public key hex — `UnshieldedKeystore.getPublicKey()`. Nexus needs this for seedless construction. */
  readonly publicKeyHex: string;
  /** Address bytes as hex — `UnshieldedKeystore.getAddress()`. Nexus needs this for seedless construction. */
  readonly addressHex: string;
  /** Sender's own shielded `mn_shield-addr_…` address — the new shielded output's destination (shield always moves value between the wallet's OWN two addresses, never to a third party). */
  readonly ownShieldedAddress: string;
  /** Sender's NightExternal secret key (Uint8Array). Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /**
   * The wallet's 32-byte Zswap secret-key seed (from
   * {@link MidnightDerivedKeys.zswapSecretKey}). Caller wipes after. Mirrors
   * {@link BuildAndSignShieldedTransferArgs.zswapSecretKeySeed}.
   */
  readonly zswapSecretKeySeed: Uint8Array;
  /** Sender's DUST secret seed (Uint8Array). Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
  readonly ttl: Date;
  /** Same DUST snapshot-bootstrap optimization as a regular unshielded send — see `SyncDustAndBalanceFeesArgs`. */
  readonly dustRegisteredAt?: Date;
  /** Optional live-progress sink for the DUST-ledger sync sub-step — see `SyncDustAndBalanceFeesArgs`. */
  readonly onDustSyncProgress?: (percent: number, detail: string) => void;
  /**
   * When present, prove (and bind) the conversion against a native-API
   * proof server at {@code url} (self-hosted docker, or Arkhia zkPaaS with
   * auth {@code headers}) before returning, instead of leaving it unproven
   * for Gero Cloud. Same shape and meaning as
   * {@link BuildAndSignShieldedTransferArgs.proving}.
   */
  readonly proving?: { readonly url: string; readonly headers?: Record<string, string> };
}

/**
 * Build + sign the SHIELD direction of a shield/unshield conversion: move
 * {@code args.amount} of public NIGHT into a brand-new shielded output at
 * the wallet's own shielded address.
 *
 * Returns the same shape as {@link buildAndSignShieldedTransfer} — signed-
 * but-unproven hex (route to Nexus's `/tx/prove-and-submit`) by default, or
 * a finalized (proven+bound) hex when {@code args.proving} is supplied
 * (route to `/tx/submit-proven`). See {@link BuildAndSignShieldResult}.
 */
export async function buildAndSignShield(
  args: BuildAndSignShieldArgs,
): Promise<BuildAndSignShieldResult> {
  debugLog('🌙 shield-swap builder: starting (shield direction)', {
    network: args.sdkNetworkId,
  });

  if (args.amount <= 0n) {
    throw new Error('Shield amount must be positive');
  }

  const [ledgerMod, addressFormatMod] = await Promise.all([
    import('@midnight-ntwrk/ledger-v8'),
    import('@midnightntwrk/wallet-sdk-address-format'),
  ]);
  const { ZswapSecretKeys, Transaction } = ledgerMod;
  // ShieldedAddress has NO static parse() (verified against the package's
  // own index.d.ts) — bech32m strings round-trip through MidnightBech32m,
  // decoded with the SAME networkId string the key manager encoded with
  // (see midnightKeyManager.ts's ShieldedAddress.codec.encode call).
  const { MidnightBech32m, ShieldedAddress } = addressFormatMod;

  // ── Step 1: Nexus builds the unshielded (public) half ─────────────
  // Swap mode: no payment output, just change back to us — the consumed
  // NIGHT moves into the shielded pool via step 2 instead of to a
  // recipient. See BuildShieldSwapTxRequest's doc comment (midnight-api.ts)
  // for the WP-SH1 wire-shape caveat.
  const api = getMidnightApi(args.endpoints.network);
  const built = await api.buildShieldSwapUnshieldedTx({
    fromAddress: args.ownUnshieldedAddress,
    publicKeyHex: args.publicKeyHex,
    addressHex: args.addressHex,
    amount: args.amount.toString(),
    ttlMs: args.ttl.getTime(),
  });
  debugLog('🌙 shield-swap: nexus built unshielded half', {
    unprovenBytes: built.unprovenTxHex.length / 2,
  });

  // Same marker triple as a regular unshielded send's deserialize (see
  // midnightTxBuilder.ts's own comment on why 'signature' not
  // 'no-signature') — Nexus builds this half via the identical
  // buildUnshieldedTransferTx path, just skipping the payment output.
  const TxAny = Transaction as unknown as {
    deserialize: (s: string, p: string, b: string, raw: Uint8Array) => ledger.UnprovenTransaction;
  };
  const unshieldedHalf = TxAny.deserialize(
    'signature', 'pre-proof', 'pre-binding', hexToBytes(built.unprovenTxHex),
  );

  // ── Step 2: build the shielded (private) half ─────────────────────
  const zswapKeys = ZswapSecretKeys.fromSeed(args.zswapSecretKeySeed);
  let shieldedWallet: Awaited<ReturnType<typeof startAndSyncShieldedWallet>> | undefined;
  try {
    shieldedWallet = await startAndSyncShieldedWallet(
      {
        sdkNetworkId: args.sdkNetworkId,
        endpoints: args.endpoints,
        zswapSecretKeySeed: args.zswapSecretKeySeed,
      },
      zswapKeys,
    );

    // A brand-new shielded output funded entirely by the unshielded half —
    // no shielded inputs spent (desiredInputs: {}), matching the SDK's own
    // documented shield-swap example (plan section 0).
    const desiredInputs: Record<ledger.RawTokenType, bigint> = {};
    const shieldedHalf = await shieldedWallet.initSwap(
      zswapKeys,
      desiredInputs,
      [{
        amount: args.amount,
        type: NIGHT_RAW_TOKEN_TYPE,
        receiverAddress: ShieldedAddress.codec.decode(
          args.sdkNetworkId,
          MidnightBech32m.parse(args.ownShieldedAddress),
        ),
      }],
    );
    debugLog('🌙 shield-swap: shielded half built (initSwap)');

    // ── Step 3: merge shielded + unshielded halves ──────────────────
    const merged = (shieldedHalf as unknown as {
      merge: (other: ledger.UnprovenTransaction) => ledger.UnprovenTransaction;
    }).merge(unshieldedHalf);
    debugLog('🌙 shield-swap: shielded + unshielded merged');

    // ── Step 4: balance DUST fees against the COMBINED tx, merge in ──
    // Balancing the unshielded half ALONE (before this merge) would
    // under-fee the final tx — mirrors the SDK facade's own initSwap
    // orchestration (balance once, after the shielded+unshielded merge; see
    // file header / plan section 0), unlike a plain single-pool transfer.
    const feeBalancingTx = await syncDustWalletAndBalanceFees(
      {
        sdkNetworkId: args.sdkNetworkId,
        endpoints: args.endpoints,
        dustSecretSeed: args.dustSecretSeed,
        ttl: args.ttl,
        dustRegisteredAt: args.dustRegisteredAt,
        onDustSyncProgress: args.onDustSyncProgress,
      },
      [merged],
    );
    const balanced = (merged as unknown as {
      merge: (other: ledger.UnprovenTransaction) => ledger.UnprovenTransaction;
    }).merge(feeBalancingTx);
    debugLog('🌙 shield-swap: dust fee merged');

    // ── Step 5: sign the unshielded-role segments (last — see the file
    // header's sequencing note) ─────────────────────────────────────
    const signed = await signUnshieldedSegments(
      args.sdkNetworkId, args.endpoints, args.unshieldedSecretKey, balanced,
    );
    debugLog('🌙 shield-swap: unshielded half signed');

    // ── Step 6: prove (wallet-side) or leave unproven (cloud) ─────────────
    if (args.proving) {
      // Wallet-side proving (local docker or Arkhia zkPaaS): identical
      // prove()->bind() sequence midnightShieldedBuilder.ts uses for a
      // plain shielded send.
      type ProvableTx = {
        prove: (provider: ledger.ProvingProvider, costModel: ledger.CostModel) =>
          Promise<{ bind: () => { serialize: () => Uint8Array } }>;
      };
      // URL only — never the auth header values.
      debugLog('🌙 shield-swap: proving wallet-side', { url: args.proving.url });
      const proveStartMs = Date.now();
      const { makeLocalProvingProvider } = await import('@/chains/midnight/midnightLocalProver');
      const provider = makeLocalProvingProvider(args.proving.url, { headers: args.proving.headers });
      const proven = await (signed as unknown as ProvableTx).prove(
        provider, ledgerMod.CostModel.initialCostModel(),
      );
      const boundBytes = proven.bind().serialize();
      debugLog(`🌙 shield-swap: wallet-side proof + bind complete (${Date.now() - proveStartMs}ms)`);
      const txHex = Buffer.from(boundBytes).toString('hex');
      debugLog('🌙 shield-swap: serialized (proven)', { bytes: boundBytes.length });
      return { txHex, proven: true };
    }

    const signedBytes = (signed as unknown as { serialize: () => Uint8Array }).serialize();
    const txHex = Buffer.from(signedBytes).toString('hex');
    debugLog('🌙 shield-swap: serialized', { bytes: signedBytes.length });
    return { txHex, proven: false };
  } finally {
    try { await shieldedWallet?.stop(); } catch { /* swallow */ }
    try { zswapKeys.clear(); } catch { /* swallow */ }
  }
}
