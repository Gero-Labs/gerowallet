/**
 * Sending a compressed NFT or a Metaplex Core asset, planned in the worker. The page names only
 * the asset id, the recipient and a fee level; the asset must be one the worker itself lists for
 * this account (walletStore.solanaAssets), and everything that decides the bytes is read fresh
 * from Nexus at send time (`GET /api/sol/assets/{id}/transfer`):
 *
 * - the owner must be this account, and the asset not frozen;
 * - a compressed NFT must sit in a V1 Bubblegum tree (the V1 transfer refuses a V2 tree), and is
 *   moved with the tree's current root and proof (Bubblegum checks the leaf belongs to the signer);
 * - a Core asset passes the collection its update authority names;
 * - the recipient must be a wallet (an on-curve key, unused or a System account);
 * - the exact message is simulated: it must succeed and cost the sender at most the fee.
 */
import type { SolanaApi } from '@/api/solana-api';
import { isOnCurveSolanaAddress, isValidSolanaAddress } from '@/chains/solana/solanaKeyManager';
import { MAX_TRANSACTION_BYTES, SYSTEM_PROGRAM_ID } from '@/chains/solana/solanaTransaction';
import { singleSignerTransaction } from '@/chains/solana/solanaTokenTransfer';
import { priorityPriceFor } from '@/chains/solana/solanaSendRules';
import {
  buildCompressedTransferMessage,
  buildCoreTransferMessage,
  estimateAssetTransferFee,
} from '@/chains/solana/solanaAssetTransfer';
import type { SolanaAssetTransferInputs } from '@/chains/solana/solanaAssets';
import type { SolanaNft } from '@/chains/solana/solanaNfts';
import { bytesToBase64 } from '@/chrome/solanaDappTx';
import {
  SolanaTokenSendError,
  holdToReview,
  senderPaysAtMost,
  type SolanaTokenPlan,
  type SolanaTokenSendRequest,
} from '@/chrome/solanaTokenSend';

export type SolanaAssetSendApi = Pick<SolanaApi, 'getFees' | 'getChainTip' | 'getAccounts' | 'simulate' | 'getAssetTransfer'>;

/** The asset `request.mint` names among the account's own compressed and Core NFTs, or null. */
export function heldSolanaAsset(request: SolanaTokenSendRequest, assets: readonly SolanaNft[] | null | undefined): SolanaNft | null {
  const id = request.mint;
  if (typeof id !== 'string') return null;
  return (assets ?? []).find((asset) => asset.mint === id && !!asset.kind) ?? null;
}

export async function planSolanaAssetSend(
  sender: { publicKey: string },
  request: SolanaTokenSendRequest,
  asset: SolanaNft,
  api: SolanaAssetSendApi,
): Promise<SolanaTokenPlan> {
  const from = sender.publicKey;
  const { recipientAddress: recipient, amount, feeLevel } = request;
  if (amount !== '1') throw new SolanaTokenSendError('INVALID_AMOUNT');
  if (feeLevel !== 'standard' && feeLevel !== 'fast') throw new SolanaTokenSendError('INVALID_REQUEST');
  if (typeof recipient !== 'string' || !isValidSolanaAddress(recipient)) throw new SolanaTokenSendError('INVALID_ADDRESS');
  if (recipient === from) throw new SolanaTokenSendError('SAME_ADDRESS');

  let inputs: SolanaAssetTransferInputs;
  let recipientAccount;
  let senderAccount;
  try {
    [inputs, [recipientAccount, senderAccount]] = await Promise.all([
      api.getAssetTransfer(asset.mint),
      api.getAccounts([recipient, from]),
    ]);
  } catch {
    throw new SolanaTokenSendError('LOOKUP_FAILED');
  }
  if (inputs.kind !== asset.kind) throw new SolanaTokenSendError('TOKEN_UNKNOWN');
  if (inputs.owner !== from) throw new SolanaTokenSendError('TOKEN_UNKNOWN');
  if (inputs.frozen) throw new SolanaTokenSendError('TOKEN_FROZEN');
  if (inputs.kind === 'compressed' && inputs.treeVersion !== 1) throw new SolanaTokenSendError('TOKEN_NOT_TRANSFERABLE');
  // A wallet: a key someone holds, unused or a plain System account.
  const plainWallet = !recipientAccount.exists || recipientAccount.owner === SYSTEM_PROGRAM_ID;
  if (!plainWallet || !isOnCurveSolanaAddress(recipient)) throw new SolanaTokenSendError('RECIPIENT_NOT_WALLET');

  const fees = await api.getFees().catch(() => undefined);
  const priority = priorityPriceFor(feeLevel, fees?.prioritizationFeeMicroLamports);
  let message: Uint8Array;
  try {
    const tip = await api.getChainTip();
    const common = { from, recipient, recentBlockhash: tip.blockhash, computeUnitPriceMicroLamports: priority };
    message = inputs.kind === 'compressed'
      ? buildCompressedTransferMessage({ ...common, leaf: inputs })
      : buildCoreTransferMessage({ ...common, asset: inputs.id, collection: inputs.collection });
  } catch {
    throw new SolanaTokenSendError('LOOKUP_FAILED');
  }
  // A deep tree with a small canopy can need more proof than one transaction holds.
  if (singleSignerTransaction(message).length > MAX_TRANSACTION_BYTES) throw new SolanaTokenSendError('TOKEN_NOT_TRANSFERABLE');
  const feeLamports = estimateAssetTransferFee(inputs.kind, priority);

  let simulation;
  try {
    simulation = await api.simulate(bytesToBase64(singleSignerTransaction(message)), [from]);
  } catch {
    throw new SolanaTokenSendError('LOOKUP_FAILED');
  }
  if (!simulation.success || !simulation.after || simulation.after.length < 1) {
    if (senderAccount.lamports === null || senderAccount.lamports < feeLamports) throw new SolanaTokenSendError('INSUFFICIENT_SOL');
    throw new SolanaTokenSendError('SIMULATION_FAILED');
  }
  senderPaysAtMost(simulation, senderAccount, feeLamports);
  holdToReview(request, feeLamports, 1n);

  return {
    message, mint: asset.mint, tokenProgram: '', decimals: 0, amount: 1n, received: 1n, recipient, destination: recipient,
    createsAccount: false, rentLamports: 0n, feeLamports, programmable: false, refundLamports: 0n,
  };
}
