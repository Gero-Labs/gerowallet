// Local prove + bind for the UNSHIELDED NIGHT transfer path (XDP R5).
//
// Takes a SIGNED-but-UNPROVEN unshielded tx — exactly what
// `balanceAndSignUnshieldedTransfer` (midnightTxBuilder.ts) returns and what
// Nexus's `/tx/submit` relay hands to the sidecar's `/tx/finalize` today — and
// performs the sidecar's own operation locally: deserialize -> prove + bind
// against a native-API proof server -> re-serialize a FINALIZED tx.
//
// Why this exists even though the send path already works: every unshielded
// NIGHT send is proven SOMEWHERE, because the DUST fee mechanism is
// zero-knowledge. Proving it through Gero Cloud means the sidecar sees the
// witness of every send. Running the same prove+bind against the user's own
// proof server (localhost:6300) keeps the witness on the user's machine.
//
// Two consumers:
//   1. Cross-Device Proving (XDP): the BG prover service decrypts a phone's
//      unproven tx, calls this, and streams the finalized tx back. The phone
//      cannot run a proof server; the paired desktop can.
//   2. The desktop wallet itself — cloud-blind unshielded sends, no mobile
//      involved. NOTE: that path additionally needs Nexus's `/tx/submit-proven`
//      to accept an unshielded finalized tx (it was defined for the SHIELDED
//      local-prove path, see midnight-tx.service.ts:363-383). Until that is
//      confirmed, this module is the proving primitive only and no send path is
//      re-routed through it.
//
// This is deliberately the ONLY new logic: deserialization markers come from
// `midnightTxBuilder.ts` and the prove->bind->serialize sequence from
// `midnightShieldedBuilder.ts`, so all three paths stay in step.
//
// PRIVACY (ground rule 13, same as midnightLocalProver.ts): never log tx hex or
// any proof/preimage body — those carry the witness. Byte lengths, durations,
// and the target URL are fine.
//
// ⚠️ TESTING: if you ever write an integration test for this, drive it with the
// ledger's REAL `prove()`, never `mockProve()`. iOS measured that `mockProve()`
// REWRITES THE IDENTIFIER BYTES — it is size-faithful but not identity-faithful
// (their 2026-08-11 reply §5). The phone's verify-before-submit gate compares
// `eraseProofs().serialize()` of what it sent against what came back, so a
// verifier built or tested against `mockProve()` output rejects every real
// proof this function produces. The existing R3 tests are unaffected: they stub
// proving as opaque bytes and never inspect proof structure.
//
// ⚠️ DO NOT gate submission on `wellFormed(…)`'s proofValid. When R5's send
// wiring lands (Q4-gated), the obvious-looking "verify the proof before
// submitting" step is a trap: iOS measured that `wellFormed` takes a `tblock`
// and enforces the intent TTL against WALL CLOCK, so an honest, live tx reads
// proofValid:false near its TTL edge ("Intent TTL has expired" / "…too far in
// the future"). Gating on it false-rejects real sends. It is fine as advisory
// telemetry only. The anti-tamper property to check instead is
// `eraseProofs().serialize()` equality, which is time-invariant — that is what
// the phone's verify-before-submit gate uses.

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { debugLog } from '@/utils/debug';
import { LocalProvingError } from '@/chains/midnight/midnightShieldedBuilder';
import { hexToBytes } from '@/chains/midnight/midnightTxBuilder';

export interface ProveUnshieldedTransferArgs {
  /**
   * Hex of the signed-but-unproven unshielded tx. Markers are
   * `signature / pre-proof / pre-binding` — see {@link deserializeSignedUnproven}.
   */
  readonly signedTxHex: string;
  /**
   * Native-API proof server to prove against: the user's own docker server
   * (`http://localhost:6300`) or an Arkhia zkPaaS gateway (auth via
   * {@code headers}).
   *
   * Only `localhost` keeps the witness on this machine. zkPaaS ships it to
   * Arkhia — same trust downgrade the shielded path consent-gates
   * (midnight-tx.service.ts:249-259). For XDP, callers MUST pass a local URL:
   * proving a phone's tx against a third-party gateway would defeat the entire
   * point of moving proving off Gero Cloud.
   */
  readonly proving: { readonly url: string; readonly headers?: Record<string, string> };
}

export interface ProveUnshieldedTransferResult {
  /** Hex of the FINALIZED tx (markers `signature / proof / binding`). */
  readonly provenTxHex: string;
  /** Wall-clock time in prove() + bind(), for proving-history + XDP budgeting. */
  readonly proveDurationMs: number;
}

/**
 * The SDK's `Transaction.deserialize` is typed against its marker generics;
 * the runtime function takes the three marker strings plus the raw bytes.
 * Narrow-cast exactly as `midnightTxBuilder.ts:564-566` does.
 */
type DeserializableTx = {
  deserialize: (s: string, p: string, b: string, raw: Uint8Array) => ledger.UnprovenTransaction;
};

/** Same narrow-cast as `midnightShieldedBuilder.ts:212-215`. */
type ProvableTx = {
  prove: (
    provider: ledger.ProvingProvider,
    costModel: ledger.CostModel,
  ) => Promise<{ bind: () => { serialize: () => Uint8Array } }>;
};

/**
 * Deserialize a signed-but-unproven unshielded tx.
 *
 * The marker triple is `signature / pre-proof / pre-binding`, NOT
 * `no-signature/...`: `UnshieldedOffer.new(inputs, outputs, sigs)` returns
 * `UnshieldedOffer<SignatureEnabled>` regardless of whether signatures are
 * present yet (ledger-v8.d.ts:1970), and signing does not change the marker
 * either — so the same triple reads both the pre-signature tx Nexus builds and
 * the post-signature tx we prove here. Getting it wrong does not fail cleanly:
 * the SDK misinterprets the bytes and surfaces a cryptic "Invalid signature
 * value" out of the ledger WASM. This is the identical reasoning recorded at
 * `midnightTxBuilder.ts:556-563`; keep the two in sync.
 */
function deserializeSignedUnproven(
  Transaction: unknown,
  raw: Uint8Array,
): ledger.UnprovenTransaction {
  return (Transaction as DeserializableTx).deserialize(
    'signature', 'pre-proof', 'pre-binding', raw,
  );
}

/**
 * Prove + bind a signed-but-unproven unshielded NIGHT tx locally, returning the
 * finalized tx hex. This is the same operation Nexus's sidecar performs at
 * `/tx/finalize`, run on the user's own proof server instead.
 *
 * Throws {@link LocalProvingError} (carrying the elapsed duration, so callers
 * can record an accurate proving-history entry) when prove or bind fails, and a
 * plain Error for a malformed input hex — that one happens before any proving
 * starts, so it has no duration to report.
 */
export async function proveUnshieldedTransfer(
  args: ProveUnshieldedTransferArgs,
): Promise<ProveUnshieldedTransferResult> {
  let signedBytes: Uint8Array;
  try {
    signedBytes = hexToBytes(args.signedTxHex);
  } catch {
    // hexToBytes names the field it was written for; restate it for this caller.
    throw new Error('signedTxHex is not valid hex');
  }

  const ledgerMod = await import('@midnight-ntwrk/ledger-v8');
  const signedTx = deserializeSignedUnproven(ledgerMod.Transaction, signedBytes);
  debugLog('🌙 unshielded prove: signed tx deserialized', { bytes: signedBytes.length });

  // URL only — never the auth header values (file-header privacy note).
  debugLog('🌙 unshielded prove: proving wallet-side', { url: args.proving.url });
  const proveStartMs = Date.now();
  let boundBytes: Uint8Array;
  try {
    const { makeLocalProvingProvider } = await import('@/chains/midnight/midnightLocalProver');
    const provider = makeLocalProvingProvider(args.proving.url, { headers: args.proving.headers });
    const proven = await (signedTx as unknown as ProvableTx).prove(
      provider, ledgerMod.CostModel.initialCostModel(),
    );
    // bind() is INSIDE the try (the shielded path leaves it outside): a bind
    // failure is still a local-proving failure the user should see in proving
    // history with its real duration, not an untyped throw.
    boundBytes = proven.bind().serialize();
  } catch (err) {
    const durationMs = Date.now() - proveStartMs;
    const message = err instanceof Error ? err.message : String(err);
    debugLog(`🌙 unshielded prove: failed after ${durationMs}ms`, message);
    throw new LocalProvingError(message, durationMs, { cause: err });
  }

  const proveDurationMs = Date.now() - proveStartMs;
  debugLog(
    `🌙 unshielded prove: prove + bind complete (${proveDurationMs}ms)`,
    { bytes: boundBytes.length },
  );
  return {
    provenTxHex: Buffer.from(boundBytes).toString('hex'),
    proveDurationMs,
  };
}
