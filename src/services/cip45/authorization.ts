import type { Cip45Authorization, Cip45WalletContext } from './types';

export const CIP45_REVOKED = 'CIP-45 connection expired or wallet changed';

export function walletContext(wallet: { id?: unknown; chain?: string; network?: string } | null | undefined): Cip45WalletContext | null {
  if (wallet?.id == null || !wallet.chain || !wallet.network) return null;
  return { walletId: String(wallet.id), chain: wallet.chain, network: wallet.network };
}

export function sameWallet(a: Cip45WalletContext | null, b: Cip45WalletContext | null): boolean {
  return !!a && !!b && a.walletId === b.walletId && a.chain === b.chain && a.network === b.network;
}

/** Background-owned, memory-only grants. Persisted UI state never authorizes RPCs. */
export class Cip45AuthorizationRegistry {
  private grants = new Map<string, { owner: string; binding: Cip45Authorization; active: boolean }>();
  private context: Cip45WalletContext | null = null;

  setWallet(context: Cip45WalletContext | null): boolean {
    const changed = !sameWallet(this.context, context);
    if (changed) this.grants.clear();
    this.context = context;
    return changed;
  }

  begin(owner: string, context: Cip45WalletContext, dappPeerId: string): Cip45Authorization {
    if (!owner || !dappPeerId || !sameWallet(this.context, context)) throw new Error(CIP45_REVOKED);
    // One connection per dashboard document. Other dashboard tabs have separate grants.
    for (const [id, grant] of this.grants) if (grant.owner === owner) this.grants.delete(id);
    const binding = { ...context, dappPeerId, sessionId: crypto.randomUUID() };
    this.grants.set(binding.sessionId, { owner, binding, active: false });
    return binding;
  }

  assert(binding: Cip45Authorization | undefined, owner?: string, requireActive = true): void {
    if (!binding) throw new Error(CIP45_REVOKED);
    const grant = this.grants.get(binding.sessionId);
    if (!grant || (owner !== undefined && grant.owner !== owner)
      || (requireActive && !grant.active)
      || !sameWallet(grant.binding, this.context)
      || !sameWallet(grant.binding, binding)
      || grant.binding.dappPeerId !== binding.dappPeerId) throw new Error(CIP45_REVOKED);
  }

  activate(owner: string, binding: Cip45Authorization): void {
    this.assert(binding, owner, false);
    this.grants.get(binding.sessionId)!.active = true;
  }

  revoke(owner: string, binding: Cip45Authorization): void {
    const grant = this.grants.get(binding?.sessionId);
    if (grant?.owner === owner) this.grants.delete(binding.sessionId);
  }

}
