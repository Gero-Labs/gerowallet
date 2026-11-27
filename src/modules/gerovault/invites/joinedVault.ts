/**
 * The vault a cosigner joined by invitation, built on their own device for the GV-61 ceremony:
 * their own keys at the index they accepted with (from their CIP-1854 account key, behind their
 * credential) and the inviter's two vault keys from the checked INVITE. Every participant who
 * builds from the same keys gets the same scripts, so the same 40-digit number.
 *
 * This round only a two-owner vault can be built here: an invitation carries the inviter's keys
 * and the other participants' labels, never their keys (`PROTOCOL.md` open question 3, the setup
 * state relay). For more owners the cosigner waits for that relay.
 */
import {
  encodeVaultPublicKeys,
  vaultKeyHashes,
  type CosignerVerification,
  type MultisigAccountPublicKey,
  type VaultNetwork,
} from '@/shared/gerovault';
import type { VaultRecord, VaultStore } from '@/modules/gerovault/contracts';
import {
  buildCreatedVault,
  candidateInput,
  firstManifest,
  ownVaultKeys,
  recordNumberMatch,
  saveCreatedVault,
  type CreatedVault,
  type ManifestState,
  type ReadyCosigner,
} from '@/modules/gerovault/create/createVault';
import { vaultKeysFromRaw } from './rawKeys';
import type { ReceivedView } from './inviteClient';

export type JoinedVaultProblem = 'MORE_OWNERS' | 'NOT_JOINED' | 'KEY_MISMATCH';

export function joinedVaultProblem(invite: Pick<ReceivedView, 'vault' | 'join'>): JoinedVaultProblem | null {
  if (!invite.join) return 'NOT_JOINED';
  return invite.vault.owners === 2 ? null : 'MORE_OWNERS';
}

export interface JoinedVault {
  readonly vault: CreatedVault;
  readonly manifestState: ManifestState;
}

/**
 * Builds the two-owner vault from this wallet's account key and the invitation. Throws
 * `KEY_MISMATCH` when the account key does not give the keys this device accepted with (another
 * wallet's credential was given), and `GeroVaultError` for anything the library refuses.
 */
export async function buildJoinedVault(account: MultisigAccountPublicKey, invite: ReceivedView, revisedAt: number): Promise<JoinedVault> {
  const problem = joinedVaultProblem(invite);
  if (problem) throw Object.assign(new Error(problem), { code: problem });
  const join = invite.join!;
  const own = await ownVaultKeys(account, { index: join.ownIndex, reused: false });
  if (own.vaultKeys.payment !== join.payment || own.vaultKeys.stake !== join.stake) throw Object.assign(new Error('KEY_MISMATCH'), { code: 'KEY_MISMATCH' });
  const inviterKeys = vaultKeysFromRaw(invite.inviter.payment, invite.inviter.stake);
  const inviter: ReadyCosigner = Object.freeze({
    source: 'gero',
    label: invite.inviter.label,
    vaultKeys: inviterKeys,
    encoded: encodeVaultPublicKeys(inviterKeys),
    hashes: await vaultKeyHashes(inviterKeys),
  });
  const network: VaultNetwork = invite.network;
  // The joiner saw the terms on the review sheet (cost first, the all-owners warning included).
  const template = { owners: 2, threshold: invite.vault.threshold, acknowledged: true };
  const vault = await buildCreatedVault({ network, template, own, cosigners: [inviter] });
  return { vault, manifestState: await firstManifest(vault, revisedAt) };
}

/** The number was read with the inviter: record it and keep the vault, accepted, with that record. */
export async function saveJoinedVault(
  store: VaultStore,
  walletId: number,
  joined: JoinedVault,
  vaultName: string,
  atSeconds: number,
): Promise<{ record: VaultRecord; verifications: readonly CosignerVerification[] }> {
  const state = joined.manifestState;
  if (!state.ok) throw Object.assign(new Error('NO_MANIFEST'), { code: 'NO_MANIFEST' });
  const inviter = joined.vault.cosigners[0];
  const verifications = recordNumberMatch(joined.vault, state.manifest, [], inviter.hashes.payment, atSeconds);
  const record = await saveCreatedVault(store, walletId, candidateInput(joined.vault, vaultName, state.manifest), verifications);
  return { record, verifications };
}
