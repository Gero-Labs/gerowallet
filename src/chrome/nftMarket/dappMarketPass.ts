// The worker's side of the dApp pass (marketAllowance.ts): opened by a dApp signing entry for the
// exact CBOR the dApp sent, dropped when that request is answered. The only way a pass is made.

import type { Cardano } from '@cardano-sdk/core';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { dropDappMarketPass, grantDappMarketPass } from '@/chrome/nftMarket/marketAllowance';

/** What the pass needs of the logged wallet: who it is and what the transaction touches. */
export interface PassWallet {
  id: number;
  findMarketTouch?: (transaction: Cardano.Tx) => string[];
}

const nothingToDrop = (): void => undefined;

/**
 * Open a pass for a dApp's signing request, from the CBOR the dApp sent: the transaction id is
 * that of the parsed body and the hits are what the wallet finds it to touch. Nothing a page
 * claims about the request (an origin, a flag) is read. A transaction that touches no market
 * script or own listing needs no pass and gets none; so does one that does not parse (the
 * signer would fail on it anyway). Returns the function that drops the pass: call it when the
 * request is answered, whether approved, rejected or abandoned.
 */
export function openDappMarketPass(wallet: PassWallet | null | undefined, txCbor: unknown): () => void {
  if (typeof txCbor !== 'string' || !txCbor || !wallet?.findMarketTouch) return nothingToDrop;
  try {
    const tx = deserializeCardanoJsSdkTx(txCbor);
    const hits = wallet.findMarketTouch(tx);
    if (hits.length === 0) return nothingToDrop;
    const walletId = wallet.id;
    grantDappMarketPass(walletId, tx.id, hits);
    return () => dropDappMarketPass(walletId, tx.id);
  } catch {
    return nothingToDrop;
  }
}
