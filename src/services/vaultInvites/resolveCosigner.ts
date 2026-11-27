/**
 * "Name, $handle or address" to the stake credential an invitation is addressed to
 * (`PROTOCOL.md` section 6, step 2). Resolution is local: the address is read here, and an ADA
 * Handle goes through the wallet's existing resolver, whose answer is shown as "resolved by
 * provider" and never trusted beyond addressing (the GV-61 number verifies, not the handle).
 *
 * Only key-based stake credentials can be invited (as in notify): an enterprise address, a pointer
 * address or a script stake credential is refused with its own code.
 */
import { Cardano } from '@cardano-sdk/core';
import { HANDLE_PATTERN } from '@/shared/gerovault/invite';
import type { VaultNetwork } from '@/shared/gerovault';

export type ResolveProblem =
  | 'EMPTY'
  | 'NOT_AN_ADDRESS'
  | 'WRONG_NETWORK'
  | 'NO_STAKE_KEY'
  | 'SCRIPT_STAKE_KEY'
  | 'HANDLE_NOT_FOUND'
  | 'HANDLE_UNAVAILABLE'
  | 'SELF';

export interface ResolvedCosigner {
  readonly stakeCredential: string;
  readonly kind: 'address' | 'handle';
  /** The handle as typed, lowercased (`$name`), when the entry was one. */
  readonly handle?: string;
  /** The address the entry resolved to (the handle's address, or the entry itself). */
  readonly address: string;
}

export type ResolveResult = { readonly ok: true; readonly value: ResolvedCosigner } | { readonly ok: false; readonly problem: ResolveProblem };

const KEY_HASH = /^[0-9a-f]{56}$/;

export function networkIdOf(network: VaultNetwork): Cardano.NetworkId {
  return network === 'mainnet' ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
}

/** The key-based stake credential of a base or reward address on `network`. Never throws. */
export function stakeCredentialOfAddress(text: string, network: VaultNetwork): { ok: true; credential: string } | { ok: false; problem: ResolveProblem } {
  let address: Cardano.Address | null = null;
  try {
    address = Cardano.Address.fromString(text.trim());
  } catch {
    address = null;
  }
  if (!address) return { ok: false, problem: 'NOT_AN_ADDRESS' };
  if (address.getNetworkId() !== networkIdOf(network)) return { ok: false, problem: 'WRONG_NETWORK' };
  let credential: Cardano.Credential | undefined;
  const type = address.getType();
  if (type === Cardano.AddressType.BasePaymentKeyStakeKey || type === Cardano.AddressType.BasePaymentScriptStakeKey) {
    credential = Cardano.BaseAddress.fromAddress(address)?.getStakeCredential();
  } else if (type === Cardano.AddressType.BasePaymentKeyStakeScript || type === Cardano.AddressType.BasePaymentScriptStakeScript || type === Cardano.AddressType.RewardScript) {
    return { ok: false, problem: 'SCRIPT_STAKE_KEY' };
  } else if (type === Cardano.AddressType.RewardKey) {
    credential = Cardano.RewardAddress.fromAddress(address)?.getPaymentCredential();
  } else {
    return { ok: false, problem: 'NO_STAKE_KEY' };
  }
  if (!credential) return { ok: false, problem: 'NO_STAKE_KEY' };
  if (credential.type !== Cardano.CredentialType.KeyHash) return { ok: false, problem: 'SCRIPT_STAKE_KEY' };
  const hash = String(credential.hash).toLowerCase();
  return KEY_HASH.test(hash) ? { ok: true, credential: hash } : { ok: false, problem: 'NOT_AN_ADDRESS' };
}

export interface ResolveDeps {
  /** The existing ADA Handle resolver: the handle's ADA address, `null` when it has none, throws when unreachable. */
  resolveHandle(handle: string): Promise<string | null>;
  /** The inviting wallet's own stake credential, to refuse inviting oneself. */
  ownCredential?: string;
}

/** Resolves an entry. A plain name is not an address: the page offers the contacts for it. */
export async function resolveCosignerEntry(entry: unknown, network: VaultNetwork, deps: ResolveDeps): Promise<ResolveResult> {
  if (typeof entry !== 'string' || entry.trim() === '') return { ok: false, problem: 'EMPTY' };
  const text = entry.trim();
  let resolved: ResolvedCosigner;
  if (text.startsWith('$')) {
    const handle = text.toLowerCase();
    if (!HANDLE_PATTERN.test(handle)) return { ok: false, problem: 'HANDLE_NOT_FOUND' };
    let address: string | null;
    try {
      address = await deps.resolveHandle(handle.slice(1));
    } catch {
      return { ok: false, problem: 'HANDLE_UNAVAILABLE' };
    }
    if (!address) return { ok: false, problem: 'HANDLE_NOT_FOUND' };
    const read = stakeCredentialOfAddress(address, network);
    if (read.ok === false) return { ok: false, problem: read.problem === 'NOT_AN_ADDRESS' ? 'HANDLE_NOT_FOUND' : read.problem };
    resolved = { stakeCredential: read.credential, kind: 'handle', handle, address };
  } else {
    const read = stakeCredentialOfAddress(text, network);
    if (read.ok === false) return read;
    resolved = { stakeCredential: read.credential, kind: 'address', address: text };
  }
  if (deps.ownCredential && resolved.stakeCredential === deps.ownCredential) return { ok: false, problem: 'SELF' };
  return { ok: true, value: resolved };
}
