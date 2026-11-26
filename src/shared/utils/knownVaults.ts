/**
 * The script hashes of every vault (GeroVault, CIP-1854 native-script multisig) the wallet knows:
 * accepted vaults and quarantined candidates alike. The generic signers refuse a transaction that
 * touches one (vaultSignGuard.ts), because a vault transaction is approved on the vault screen and
 * nowhere else.
 *
 * Read only, and the one place that later work fills in. GeroVault stores no vault yet, so both
 * sets are empty and no transaction is refused on this ground.
 *
 * Whoever fills it in: a store that cannot be read must make this throw, never answer empty sets.
 * The signers let the throw through, so a failed read refuses the signature instead of letting a
 * vault transaction past.
 */
export interface KnownVaultScriptHashes {
  /** The payment script hash of each known vault, lowercase hex. */
  readonly payment: ReadonlySet<string>;
  /** The stake script hash of each known vault, lowercase hex. */
  readonly stake: ReadonlySet<string>;
}

export async function knownVaultScriptHashes(): Promise<KnownVaultScriptHashes> {
  return { payment: new Set<string>(), stake: new Set<string>() };
}
