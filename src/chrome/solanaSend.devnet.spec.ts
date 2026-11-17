// @vitest-environment node
/**
 * Opt-in end-to-end check of Gero's own SOL send on the public devnet, through Nexus.
 * Skipped unless VITE_SOLANA_DEVNET_E2E is set:
 *
 *   VITE_SOLANA_DEVNET_E2E=1 npx vitest run src/chrome/solanaSend.devnet.spec.ts
 *
 * It runs the worker's real `quoteSolanaSend` / `sendSolana` against the real `SolanaApi`
 * (Nexus, an anonymous device token) with a key derived by the wallet's own derivation from
 * a recovery phrase, and checks the result on chain. Public devnet's RPC faucet is closed:
 * fund account #0 of a phrase at faucet.solana.com (at least 0.2 SOL) and pass the phrase in
 * VITE_SOLANA_DEVNET_MNEMONIC. Without it the test tries an RPC airdrop to a fresh phrase.
 */
import { describe, expect, it, vi } from 'vitest';

const E2E = import.meta.env['VITE_SOLANA_DEVNET_E2E'] as string | undefined;
const FUNDED_MNEMONIC = import.meta.env['VITE_SOLANA_DEVNET_MNEMONIC'] as string | undefined;
const NEXUS = (import.meta.env['VITE_NEXUS_API_URL'] as string | undefined) || 'https://nexus.gerowallet.io';
const DEVNET_RPC = 'https://api.devnet.solana.com';

const store = vi.hoisted(() => ({ state: { solana: { lamports: null as string | null } } }));
vi.mock('@/stores/walletStore', () => ({ default: store }));
vi.mock('@/services/nexusDevice.service', () => {
  let token: Promise<string> | undefined;
  const login = async () => {
    const res = await fetch(`${NEXUS}/api/auth/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: crypto.randomUUID(), platform: 'chrome-extension', appVersion: 'devnet-e2e' }),
    });
    if (!res.ok) throw new Error(`device login ${res.status}`);
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  return {
    getNexusAccessToken: () => (token ??= login()),
    reauthenticateNexus: () => (token = login()),
  };
});

import { generateMnemonic } from 'bip39';
import { quoteSolanaSend, sendSolana, SolanaSendError, type SolanaSendWallet } from './solanaSend';
import { SolanaApi } from '@/api/solana-api';
import { deriveSolanaKeypairFromMnemonic } from '@/chains/solana/solanaKeyManager';
import { buildSignedSolTransfer } from '@/chains/solana/solanaTransaction';
import { SOLANA_RENT_EXEMPT_MINIMUM } from '@/chains/solana/solanaSendRules';

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(DEVNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json() as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

async function confirmed(signature: string): Promise<{ err: unknown }> {
  for (let i = 0; i < 90; i++) {
    const { value } = await rpc<{ value: Array<{ confirmationStatus?: string; err: unknown } | null> }>(
      'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
    const status = value[0];
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return status;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`not confirmed: ${signature}`);
}

const chainBalance = async (address: string) =>
  BigInt((await rpc<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }])).value);

describe.skipIf(!E2E)('Gero SOL send on devnet through Nexus', () => {
  it('quotes, refuses a below-rent transfer, then sends and lands on chain', async () => {
    const mnemonic = FUNDED_MNEMONIC || generateMnemonic(128);
    const sender = deriveSolanaKeypairFromMnemonic(mnemonic, 0);
    const recipient = deriveSolanaKeypairFromMnemonic(mnemonic, 1).address;
    const empty = deriveSolanaKeypairFromMnemonic(generateMnemonic(128), 0).address;
    const api = new SolanaApi('Devnet');

    if (!FUNDED_MNEMONIC) {
      await confirmed(await rpc<string>('requestAirdrop', [sender.address, 500_000_000, { commitment: 'confirmed' }]));
    }

    // The balance the worker trusts is Gero Sync's; here it is what Nexus reports.
    const nexusBalance = (await api.getBalance(sender.address)).lamports;
    expect(nexusBalance).toBe(await chainBalance(sender.address));
    store.state.solana.lamports = nexusBalance.toString();

    const wallet: SolanaSendWallet = {
      chain: 'Solana',
      network: 'Devnet',
      publicKey: sender.address,
      signSolanaTransfer: async (params) => {
        const keypair = deriveSolanaKeypairFromMnemonic(mnemonic, 0);
        try {
          return buildSignedSolTransfer({ ...params, from: keypair.address }, keypair.secretKey);
        } finally {
          keypair.secretKey.fill(0);
        }
      },
    };

    const quote = await quoteSolanaSend(wallet, api);
    console.info('quote', quote);
    expect(BigInt(quote.fees.standard)).toBeGreaterThanOrEqual(5000n);

    // Opening an empty account with less than rent is refused before anything is signed.
    await expect(sendSolana(wallet, { recipientAddress: empty, lamports: '1000', feeLevel: 'standard', password: 'x' }, api))
      .rejects.toEqual(new SolanaSendError('RECIPIENT_BELOW_RENT'));

    const before = await chainBalance(recipient);
    const amount = 100_000_000n;
    const { signature } = await sendSolana(
      wallet, { recipientAddress: recipient, lamports: amount.toString(), feeLevel: 'fast', password: 'x' }, api);
    console.info('sent', `https://solscan.io/tx/${signature}?cluster=devnet`);

    expect((await confirmed(signature)).err).toBeNull();
    expect(await chainBalance(recipient)).toBe(before + amount);
    const tx = await rpc<{ meta: { fee: number } }>('getTransaction',
      [signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    // The send reads the fee sample again, so the price may have moved since the quote.
    console.info('fee paid', tx.meta.fee, 'quoted fast', quote.fees.fast);
    expect(BigInt(tx.meta.fee)).toBeGreaterThanOrEqual(5000n);
    expect(await chainBalance(sender.address)).toBe(nexusBalance - amount - BigInt(tx.meta.fee));
    expect(nexusBalance - amount - BigInt(tx.meta.fee)).toBeGreaterThanOrEqual(SOLANA_RENT_EXEMPT_MINIMUM);
  }, 240_000);
});
