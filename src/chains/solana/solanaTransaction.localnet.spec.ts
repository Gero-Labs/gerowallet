// @vitest-environment node
/**
 * Opt-in end-to-end check: transfers built and signed by solanaTransaction.ts are accepted
 * by a real Solana validator. Skipped unless VITE_SOLANA_LOCALNET_RPC is set, e.g.
 *
 *   solana-test-validator --reset            # (or the solana-local stack)
 *   VITE_SOLANA_LOCALNET_RPC=http://127.0.0.1:8899 npx vitest run src/chains/solana/solanaTransaction.localnet.spec.ts
 */
import { describe, expect, it } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import { base58Encode } from './solanaBase58';
import { buildSignedSolTransfer, estimateSolTransferFee } from './solanaTransaction';

// import.meta.env, not process.env: the test build polyfills `process` (vite-plugin-node-polyfills).
const RPC = import.meta.env['VITE_SOLANA_LOCALNET_RPC'] as string | undefined;

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC as string, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json() as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

async function confirmed(signature: string): Promise<{ err: unknown }> {
  for (let i = 0; i < 60; i++) {
    const { value } = await rpc<{ value: Array<{ confirmationStatus?: string; err: unknown } | null> }>(
      'getSignatureStatuses', [[signature]]);
    const status = value[0];
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return status;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`not confirmed: ${signature}`);
}

const balance = async (address: string) =>
  BigInt((await rpc<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }])).value);

function randomKeypair() {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, address: base58Encode(ed25519.getPublicKey(secretKey)) };
}

describe.skipIf(!RPC)('SOL transfers on a local validator', () => {
  it('a plain transfer and a priority-fee transfer land with the expected balances', async () => {
    const sender = randomKeypair();
    const recipient = randomKeypair();
    await confirmed(await rpc<string>('requestAirdrop', [sender.address, 2_000_000_000, { commitment: 'confirmed' }]));

    let expectedSender = 2_000_000_000n;
    let expectedRecipient = 0n;
    for (const [lamports, price] of [[1_000_000_000n, 0n], [250_000_000n, 50_000n]] as const) {
      const { value } = await rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const { signature, base64 } = buildSignedSolTransfer({
        from: sender.address, to: recipient.address, lamports, recentBlockhash: value.blockhash,
        computeUnitPriceMicroLamports: price,
      }, sender.secretKey);
      const sent = await rpc<string>('sendTransaction', [base64, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
      expect(sent).toBe(signature);
      expect((await confirmed(signature)).err).toBeNull();

      const tx = await rpc<{ meta: { fee: number; err: unknown } }>('getTransaction', [signature, { commitment: 'confirmed', encoding: 'json' }]);
      expect(tx.meta.err).toBeNull();
      expect(BigInt(tx.meta.fee)).toBe(estimateSolTransferFee(price));

      expectedSender -= lamports + BigInt(tx.meta.fee);
      expectedRecipient += lamports;
    }
    expect(await balance(sender.address)).toBe(expectedSender);
    expect(await balance(recipient.address)).toBe(expectedRecipient);
  }, 120_000);
});
