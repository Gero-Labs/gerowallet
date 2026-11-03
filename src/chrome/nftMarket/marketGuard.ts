// What makes a transaction a Gero market transaction, for the signing guard (WalletBg.signTx and
// the hardware refusal): it either puts something at one of the Gero listing scripts or spends
// one of the wallet's own listings. Such a transaction may be signed only after the worker
// verified it (marketAllowance.ts); every other transaction is none of the guard's business.
//
//   creates-listing:<ix>   output <ix> is paid to a deployed Gero listing script, whatever stake
//                          part its address carries (the wallet's own, another key's, none, a
//                          pointer). A listing is made by anyone sending an NFT there, so the
//                          guard does not ask whose it is.
//   spends-listing:<ref>   an input is one of the wallet's own listings (`ownListedRefs`, the
//                          `txId#index` of `walletStore.listedListings`): cancelling or repricing
//                          it moves the user's NFT, so it is held to the same rule.
//
// Reference inputs and collateral are not spent as inputs and do not count: reading a listing's
// reference script is how a buy or cancel is built, and a script UTxO cannot be collateral.
// Buying someone else's listing spends an input that is not the wallet's own and creates no
// listing, so it is not a hit either: a dApp that does it is previewed at its approval screen.

import { Cardano } from '@cardano-sdk/core';
import type { NftMarketDeployment } from '@/utils/nftMarketDeployments';

/**
 * The payment script hash of any address shape that has a payment credential (base, enterprise,
 * pointer), or null for a key credential or any other shape (never throws). Shared with the
 * dApp approval preview (`txApprovalSummary.ts`), so what the user is shown as "creates a
 * listing" is exactly what the signing guard holds.
 */
export function paymentScriptHash(address: string): string | null {
  try {
    const parsed = Cardano.Address.fromString(address);
    const credential = parsed?.asBase()?.getPaymentCredential()
      ?? parsed?.asEnterprise()?.getPaymentCredential()
      ?? parsed?.asPointer()?.getPaymentCredential();
    return credential?.type === Cardano.CredentialType.ScriptHash ? credential.hash : null;
  } catch {
    // Reward, Byron or unreadable: not a payment to a script.
    return null;
  }
}

/**
 * The reasons `tx` touches the Gero market, in a fixed order: every output at a deployed listing
 * script by output index, then every own listing spent in input order. Empty when it touches
 * neither. Pure.
 *
 * @param deployments every configured deployment of the wallet's network (all versions)
 * @param ownListedRefs `txId#index` of the wallet's own listings
 */
export function findMarketTouch(
  tx: Cardano.Tx,
  deployments: readonly NftMarketDeployment[],
  ownListedRefs: ReadonlySet<string>,
): string[] {
  const hits: string[] = [];

  if (deployments.length > 0) {
    const scriptHashes = new Set(deployments.map((d) => d.scriptHash));
    const outputs = tx?.body?.outputs ?? [];
    for (let index = 0; index < outputs.length; index++) {
      const hash = paymentScriptHash(outputs[index].address as string);
      if (hash && scriptHashes.has(hash)) hits.push(`creates-listing:${index}`);
    }
  }

  if (ownListedRefs.size > 0) {
    const seen = new Set<string>();
    for (const input of tx?.body?.inputs ?? []) {
      const ref = `${input.txId}#${input.index}`;
      if (ownListedRefs.has(ref) && !seen.has(ref)) {
        seen.add(ref);
        hits.push(`spends-listing:${ref}`);
      }
    }
  }

  return hits;
}
