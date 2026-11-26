/**
 * The GeroVault create flow without Vue: the template's bounds, this wallet's own vault index and
 * keys, each cosigner's keys, the scripts, address and vault id, the first manifest, the
 * verification ceremony and the record the store keeps.
 *
 * Every rule is the core library's (`src/shared/gerovault`). This file only puts its calls in the
 * order the screens take them, so a screen decides nothing on its own. Every cosigner who runs the
 * same flow with the same keys gets the same scripts, so the same address and vault id, whatever
 * order the keys were entered in and whatever index each participant uses.
 *
 * Phase 1, standard template only: `atLeast M` of N owners, no backup path.
 */
import type { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import {
  GeroVaultError,
  MAX_OWNERS,
  MIN_OWNERS,
  MIN_THRESHOLD,
  ROLE,
  buildVaultFromParticipants,
  checkManifestBeforeAck,
  compareVerificationQr,
  cosignerVerificationStatus,
  deriveRoleKeys,
  deriveVaultPublicKeys,
  encodeManifest,
  encodeVaultPublicKeys,
  formatVaultKeyPath,
  fundingVerified,
  isVaultIndex,
  newManifest,
  nextVaultIndex,
  numberVerification,
  parseExternalCosignerKeys,
  parseVaultScript,
  parseVaultPublicKeys,
  qrVerification,
  vaultAddresses,
  vaultId as vaultIdOf,
  vaultKeyHashes,
  verificationDigest,
  verificationNumber,
  verificationQrPayload,
  writeLabel,
  type CosignerStatus,
  type CosignerVerification,
  type EncodedVaultPublicKeys,
  type ManifestAck,
  type ManifestAckRefusalCode,
  type MultisigAccountPublicKey,
  type ParticipantIndexHistory,
  type ParticipantKeyHashes,
  type RoleKeys,
  type VaultAddresses,
  type VaultIndexAllocation,
  type VaultManifest,
  type VaultNetwork,
  type VaultPublicKeys,
  type VaultScript,
  type VaultScripts,
  type VaultWarning,
} from '@/shared/gerovault';
import type { VaultCandidateInput, VaultRecord, VaultStore } from '@/modules/gerovault/contracts';

// -------------------------------------------------------------------------------------------------
// 1. Name and threshold

export interface TemplateChoice {
  /** A local name for the vault; empty for none. */
  readonly name: string;
  /** N: every owner, this wallet included. */
  readonly owners: number;
  /** M: the signatures a spend needs. */
  readonly threshold: number;
  /** The user acknowledged the warnings of `templateWarnings`. */
  readonly acknowledged: boolean;
}

export type TemplateProblem =
  | 'TOO_FEW_OWNERS'
  | 'TOO_MANY_OWNERS'
  | 'THRESHOLD_TOO_LOW'
  | 'THRESHOLD_OUT_OF_RANGE'
  | 'NOT_ACKNOWLEDGED'
  | 'INVALID_NAME';

export const DEFAULT_TEMPLATE: TemplateChoice = Object.freeze({ name: '', owners: 3, threshold: 2, acknowledged: false });

/**
 * The warnings the builder will ask to be acknowledged: the library's `vaultSpecWarnings` for the
 * standard template, which reads only the threshold and the number of owners.
 */
export function templateWarnings(owners: number, threshold: number): readonly VaultWarning[] {
  return Number.isInteger(owners) && threshold === owners ? ['ALL_OWNERS_REQUIRED'] : [];
}

/** The owners count the minus and plus buttons may reach. */
export function clampOwners(owners: number): number {
  return Math.min(MAX_OWNERS, Math.max(MIN_OWNERS, Math.trunc(owners) || MIN_OWNERS));
}

/** The threshold the minus and plus buttons may reach for `owners`. */
export function clampThreshold(threshold: number, owners: number): number {
  return Math.min(clampOwners(owners), Math.max(MIN_THRESHOLD, Math.trunc(threshold) || MIN_THRESHOLD));
}

/** The stored form of the name, or undefined for none. Throws `GeroVaultError('INVALID_LABEL')`. */
export function vaultNameOf(name: string): string | undefined {
  return name.trim() === '' ? undefined : writeLabel(name);
}

/** The first rule the choice breaks, in the order the screen shows them; undefined when it is complete. */
export function templateProblem(choice: TemplateChoice): TemplateProblem | undefined {
  const { owners, threshold } = choice;
  if (!Number.isInteger(owners) || owners < MIN_OWNERS) return 'TOO_FEW_OWNERS';
  if (owners > MAX_OWNERS) return 'TOO_MANY_OWNERS';
  if (!Number.isInteger(threshold) || threshold < MIN_THRESHOLD) return 'THRESHOLD_TOO_LOW';
  if (threshold > owners) return 'THRESHOLD_OUT_OF_RANGE';
  try {
    vaultNameOf(choice.name);
  } catch {
    return 'INVALID_NAME';
  }
  if (templateWarnings(owners, threshold).length > 0 && !choice.acknowledged) return 'NOT_ACKNOWLEDGED';
  return undefined;
}

// -------------------------------------------------------------------------------------------------
// 2 and 3. This wallet's own keys

/**
 * This wallet's index history as far as this device knows it: its accepted vaults and its
 * candidates. No chain scan feeds it yet, so an index used from another install of the same
 * recovery phrase is not seen (a later discovery scan fills `onChain`).
 */
export function ownIndexHistory(records: readonly Pick<VaultRecord, 'ownIndex' | 'status'>[]): ParticipantIndexHistory {
  return {
    onChain: [],
    held: records.map(r => ({ index: r.ownIndex, kind: r.status === 'accepted' ? 'vault' as const : 'candidate' as const })),
    released: [],
  };
}

/** This wallet's index for the new vault (`indexAllocation.ts`): never 0, never one it holds. */
export function allocateOwnIndex(records: readonly Pick<VaultRecord, 'ownIndex' | 'status'>[]): VaultIndexAllocation {
  return nextVaultIndex(ownIndexHistory(records));
}

/** This wallet's contribution to the vault. Lives in memory for the flow only; nothing here is secret. */
export interface OwnVaultKeys {
  readonly index: number;
  /** A released index a fresh scan cleared, used again. */
  readonly reused: boolean;
  /** Kept to check the manifest's own entry against keys derived again. Never shown or stored. */
  readonly roleKeys: RoleKeys;
  readonly vaultKeys: VaultPublicKeys;
  /** What the cosigners receive: `addr_shared_vk1...` and `stake_shared_vk1...`. */
  readonly encoded: EncodedVaultPublicKeys;
  readonly hashes: ParticipantKeyHashes;
  /** `m/1854'/1815'/0'/0/i` and `.../2/i`, for the Details layer. */
  readonly paths: { readonly payment: string; readonly stake: string };
}

/** This wallet's vault keys at `index`, from its CIP-1854 account key. */
export async function ownVaultKeys(account: MultisigAccountPublicKey, allocation: { readonly index: number; readonly reused: boolean }): Promise<OwnVaultKeys> {
  const roleKeys = await deriveRoleKeys(account);
  const vaultKeys = await deriveVaultPublicKeys(roleKeys, allocation.index);
  return Object.freeze({
    index: allocation.index,
    reused: allocation.reused,
    roleKeys,
    vaultKeys,
    encoded: encodeVaultPublicKeys(vaultKeys),
    hashes: await vaultKeyHashes(vaultKeys),
    paths: Object.freeze({
      payment: formatVaultKeyPath(ROLE.PAYMENT, allocation.index),
      stake: formatVaultKeyPath(ROLE.STAKE, allocation.index),
    }),
  });
}

/** The text to hand to cosigners: both keys, one per line. A cosigner pastes it whole. */
export function shareText(encoded: EncodedVaultPublicKeys): string {
  return `${encoded.payment}\n${encoded.stake}`;
}

/** Short form of a credential for lists: the first and last four hex digits. */
export function fingerprint(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 4)}...${hex.slice(-4)}` : hex;
}

// -------------------------------------------------------------------------------------------------
// 4. Cosigners

/** `gero`: a Gero wallet sent its vault keys. `external`: another wallet gave a role or account key. */
export type CosignerSource = 'gero' | 'external';

export interface CosignerDraft {
  readonly source: CosignerSource;
  readonly label: string;
  /** As pasted. Gero: the two vault keys. External: `acct_shared_xvk1...`, or the two role keys. */
  readonly keys: string;
  /** External only: the index that wallet reports for this vault, as typed. */
  readonly index: string;
}

export type CosignerProblem =
  | 'LABEL_REQUIRED'
  | 'INVALID_LABEL'
  | 'KEYS_REQUIRED'
  | 'TWO_KEYS_EXPECTED'
  | 'INVALID_VAULT_KEYS'
  | 'EXTENDED_KEY_NOT_ACCEPTED'
  | 'VAULT_KEYS_NOT_EXTERNAL'
  | 'INVALID_EXTERNAL_KEYS'
  | 'CIP1852_KEY'
  | 'INDEX_REQUIRED'
  | 'INVALID_INDEX'
  | 'SAME_AS_YOURS'
  | 'SAME_AS_ANOTHER';

export interface ReadyCosigner {
  readonly source: CosignerSource;
  /** Passed through `writeLabel`. */
  readonly label: string;
  readonly vaultKeys: VaultPublicKeys;
  readonly encoded: EncodedVaultPublicKeys;
  readonly hashes: ParticipantKeyHashes;
  /** External only: the index the keys were derived at. */
  readonly index?: number;
}

export type CosignerReading =
  | { readonly ok: true; readonly cosigner: ReadyCosigner }
  | { readonly ok: false; readonly problem: CosignerProblem };

export const EMPTY_COSIGNER: CosignerDraft = Object.freeze({ source: 'gero', label: '', keys: '', index: '' });

const tokensOf = (text: string): string[] => text.split(/[\s,;]+/).filter(token => token.length > 0);
const INDEX_TEXT = /^(0|[1-9][0-9]{0,9})$/;

/** The two keys of a pair, by prefix when they carry one, else in the order given. */
function pairOf(tokens: readonly string[], paymentPrefix: string, stakePrefix: string): { payment: string; stake: string } {
  const payment = tokens.find(t => t.toLowerCase().startsWith(paymentPrefix)) ?? tokens[0];
  const stake = tokens.find(t => t !== payment && t.toLowerCase().startsWith(stakePrefix)) ?? tokens.find(t => t !== payment) ?? '';
  return { payment, stake };
}

function libraryCode(error: unknown): string | undefined {
  return error instanceof GeroVaultError ? error.code : undefined;
}

async function readGeroKeys(tokens: readonly string[]): Promise<VaultPublicKeys | CosignerProblem> {
  if (tokens.length !== 2) return 'TWO_KEYS_EXPECTED';
  try {
    return parseVaultPublicKeys(pairOf(tokens, 'addr_shared_vk', 'stake_shared_vk'));
  } catch (error) {
    if (libraryCode(error) === 'EXTENDED_KEY_NOT_ACCEPTED') return 'EXTENDED_KEY_NOT_ACCEPTED';
    if (libraryCode(error) !== undefined) return 'INVALID_VAULT_KEYS';
    throw error;
  }
}

async function readExternalKeys(tokens: readonly string[], indexText: string): Promise<{ keys: VaultPublicKeys; index: number } | CosignerProblem> {
  if (tokens.some(t => /^(addr|stake)_shared_vk1/i.test(t))) return 'VAULT_KEYS_NOT_EXTERNAL';
  if (tokens.some(t => /^(acct_xvk|xpub)1/i.test(t))) return 'CIP1852_KEY';
  if (tokens.length === 1 && !/^acct_shared_xvk1/i.test(tokens[0])) return 'INVALID_EXTERNAL_KEYS';
  if (tokens.length !== 1 && tokens.length !== 2) return 'INVALID_EXTERNAL_KEYS';
  const trimmed = indexText.trim();
  if (trimmed === '') return 'INDEX_REQUIRED';
  const index = INDEX_TEXT.test(trimmed) ? Number(trimmed) : NaN;
  if (!isVaultIndex(index)) return 'INVALID_INDEX';
  try {
    const roleKeys = await parseExternalCosignerKeys(tokens.length === 1
      ? { account: tokens[0] }
      : pairOf(tokens, 'addr_shared_xvk', 'stake_shared_xvk'));
    return { keys: await deriveVaultPublicKeys(roleKeys, index), index };
  } catch (error) {
    if (libraryCode(error) === 'INVALID_ACCOUNT_KEY' && tokens.some(t => /^acct_xvk/i.test(t))) return 'CIP1852_KEY';
    if (libraryCode(error) !== undefined) return 'INVALID_EXTERNAL_KEYS';
    throw error;
  }
}

/**
 * One cosigner's keys and label, as the library reads them. Gero cosigners send vault keys and
 * nothing that derives more; an external wallet's role or account key is used here, at the index
 * it reports, and only the two vault keys it gives are kept.
 */
export async function readCosigner(draft: CosignerDraft): Promise<CosignerReading> {
  const fail = (problem: CosignerProblem): CosignerReading => ({ ok: false, problem });
  if (draft.label.trim() === '') return fail('LABEL_REQUIRED');
  let label: string;
  try {
    label = writeLabel(draft.label);
  } catch {
    return fail('INVALID_LABEL');
  }
  const tokens = tokensOf(draft.keys);
  if (tokens.length === 0) return fail('KEYS_REQUIRED');
  let vaultKeys: VaultPublicKeys;
  let index: number | undefined;
  if (draft.source === 'external') {
    const read = await readExternalKeys(tokens, draft.index);
    if (typeof read === 'string') return fail(read);
    vaultKeys = read.keys;
    index = read.index;
  } else {
    const read = await readGeroKeys(tokens);
    if (typeof read === 'string') return fail(read);
    vaultKeys = read;
  }
  const cosigner: ReadyCosigner = Object.freeze({
    source: draft.source,
    label,
    vaultKeys,
    encoded: encodeVaultPublicKeys(vaultKeys),
    hashes: await vaultKeyHashes(vaultKeys),
    ...(index !== undefined ? { index } : {}),
  });
  return { ok: true, cosigner };
}

/**
 * The readings with a key repeated across participants refused: a cosigner who sent this wallet's
 * own keys back, or the same keys as an earlier cosigner. A key counted twice would let one person
 * sign twice, so it is refused here before the library refuses the whole vault.
 */
export function withoutDuplicates(own: ParticipantKeyHashes | undefined, readings: readonly CosignerReading[]): CosignerReading[] {
  const seen = new Set<string>(own ? [own.payment, own.stake] : []);
  return readings.map(reading => {
    if (reading.ok === false) return reading;
    const { payment, stake } = reading.cosigner.hashes;
    if (own && (payment === own.payment || stake === own.stake || payment === own.stake || stake === own.payment)) {
      return { ok: false, problem: 'SAME_AS_YOURS' } as const;
    }
    if (seen.has(payment) || seen.has(stake)) return { ok: false, problem: 'SAME_AS_ANOTHER' } as const;
    seen.add(payment);
    seen.add(stake);
    return reading;
  });
}

// -------------------------------------------------------------------------------------------------
// 5. Scripts, address and vault id

export interface CreatedVault {
  readonly network: VaultNetwork;
  readonly threshold: number;
  readonly scripts: VaultScripts;
  readonly vaultId: string;
  readonly addresses: VaultAddresses;
  readonly own: OwnVaultKeys;
  readonly cosigners: readonly ReadyCosigner[];
}

/**
 * The vault: scripts with each script's key hashes sorted by bytes, the base and reward addresses
 * and the vault id. Throws `GeroVaultError` for anything outside the template's bounds.
 */
export async function buildCreatedVault(input: {
  readonly network: VaultNetwork;
  readonly template: Pick<TemplateChoice, 'owners' | 'threshold' | 'acknowledged'>;
  readonly own: OwnVaultKeys;
  readonly cosigners: readonly ReadyCosigner[];
}): Promise<CreatedVault> {
  const { network, template, own, cosigners } = input;
  if (cosigners.length + 1 !== template.owners) {
    throw new GeroVaultError('TOO_FEW_OWNERS', `The vault has ${template.owners} owners, this wallet and ${template.owners - 1} cosigners`);
  }
  const scripts = await buildVaultFromParticipants({
    template: { kind: 'standard', threshold: template.threshold },
    owners: [{ roleKeys: own.roleKeys, index: own.index }, ...cosigners.map(c => ({ vaultKeys: c.vaultKeys }))],
    acknowledged: template.acknowledged ? templateWarnings(template.owners, template.threshold) : [],
  });
  return Object.freeze({
    network,
    threshold: template.threshold,
    scripts,
    vaultId: vaultIdOf(scripts, network),
    addresses: vaultAddresses(scripts, network),
    own,
    cosigners: Object.freeze([...cosigners]),
  });
}

/** A script as the Details layer shows it: its threshold and its key hashes, in script order. */
export function scriptKeys(script: VaultScript): { readonly threshold: number; readonly keys: readonly string[] } {
  const parsed = parseVaultScript(script.script);
  return parsed ? { threshold: parsed.threshold, keys: parsed.owners } : { threshold: 0, keys: [] };
}

// -------------------------------------------------------------------------------------------------
// 6. The first manifest and the verification ceremony

/**
 * - `EXTERNAL_COSIGNERS`: an external cosigner's manifest entry carries this owner's signature
 *   (`importSig`) by its vault payment key, which this module cannot make yet. Without the
 *   manifest there is no verification number, and funding stays closed.
 * - `ACK_REFUSED`: this device's own check of the manifest refused it (`code` says why).
 */
export type ManifestState =
  | { readonly ok: true; readonly manifest: VaultManifest; readonly ack: ManifestAck }
  | { readonly ok: false; readonly reason: 'EXTERNAL_COSIGNERS' }
  | { readonly ok: false; readonly reason: 'ACK_REFUSED'; readonly code: ManifestAckRefusalCode };

/** Version 1 of the vault's manifest, and this device's check of it. `revisedAt` is unix seconds. */
export async function firstManifest(vault: CreatedVault, revisedAt: number): Promise<ManifestState> {
  if (vault.cosigners.some(c => c.source === 'external')) return { ok: false, reason: 'EXTERNAL_COSIGNERS' };
  const manifest = newManifest({
    vault: vault.scripts,
    network: vault.network,
    owners: [vault.own, ...vault.cosigners].map(p => ({ vaultKeys: p.vaultKeys })),
    revisedAt,
  });
  const ack = await checkManifestBeforeAck({
    manifest,
    network: vault.network,
    own: { kind: 'participant', roleKeys: vault.own.roleKeys, index: vault.own.index, role: 'owner' },
    accepted: [],
  });
  if (ack.ok === false) return { ok: false, reason: 'ACK_REFUSED', code: ack.code };
  return { ok: true, manifest, ack };
}

export interface VerificationView {
  /** Eight groups of five digits. */
  readonly groups: readonly string[];
  /** `gero-vault/v1|VERIFY|<network>|<vaultId>|<verificationDigest>`: what the QR holds. */
  readonly qrPayload: string;
  readonly digest: string;
}

export function verificationView(manifest: VaultManifest): VerificationView {
  return Object.freeze({
    groups: verificationNumber(manifest),
    qrPayload: verificationQrPayload(manifest),
    digest: verificationDigest(manifest),
  });
}

/** The Gero cosigners a number or a QR can verify: every owner but this wallet. */
function geroCosigner(vault: CreatedVault, credential: string): boolean {
  return vault.cosigners.some(c => c.source === 'gero' && c.hashes.payment === credential);
}

/** The records with one record replaced: one per cosigner and method, for the current digest. */
function withRecord(records: readonly CosignerVerification[], record: CosignerVerification): CosignerVerification[] {
  return [...records.filter(r => !(r.credential === record.credential && r.method === record.method)), record];
}

/**
 * The user read the number with this cosigner and both screens show the same. Throws for anyone
 * who is not a Gero cosigner of this vault.
 */
export function recordNumberMatch(
  vault: CreatedVault,
  manifest: VaultManifest,
  records: readonly CosignerVerification[],
  credential: string,
  atSeconds: number,
): CosignerVerification[] {
  if (!geroCosigner(vault, credential)) throw new GeroVaultError('INVALID_VERIFICATION', 'Only a Gero cosigner is verified by the number');
  return withRecord(records, numberVerification(manifest, credential as Ed25519KeyHashHex, atSeconds));
}

export type QrRefusal = 'OTHER_VAULT' | 'DIFFERENT_KEYS' | 'MALFORMED_QR';

/**
 * This device scanned the cosigner's QR in person. Only a `MATCH` is recorded: the same vault id
 * with another verification set (`DIFFERENT_KEYS`) means someone holds other keys.
 */
export function recordQrScan(
  vault: CreatedVault,
  manifest: VaultManifest,
  records: readonly CosignerVerification[],
  credential: string,
  payload: string,
  atSeconds: number,
): { readonly ok: true; readonly records: CosignerVerification[] } | { readonly ok: false; readonly code: QrRefusal } {
  if (!geroCosigner(vault, credential)) throw new GeroVaultError('INVALID_VERIFICATION', 'Only a Gero cosigner is verified by the QR');
  const record = qrVerification(manifest, credential as Ed25519KeyHashHex, payload.trim(), atSeconds);
  if (!record) {
    const comparison = compareVerificationQr(payload.trim(), manifest);
    return { ok: false, code: comparison === 'MATCH' ? 'MALFORMED_QR' : comparison };
  }
  return { ok: true, records: withRecord(records, record) };
}

export interface VerificationState {
  /** Each cosigner, as the library reads the records against this manifest. */
  readonly cosigners: readonly CosignerStatus[];
  /** Cosigners verified for this verification set. */
  readonly verified: number;
  /** `fundingVerified`: funding a vault from this wallet waits for it. */
  readonly fundingOpen: boolean;
}

export async function verificationState(manifest: VaultManifest, ack: ManifestAck, records: readonly CosignerVerification[]): Promise<VerificationState> {
  const cosigners = await cosignerVerificationStatus(manifest, ack, records);
  return Object.freeze({
    cosigners,
    verified: cosigners.filter(c => c.state === 'verified').length,
    fundingOpen: await fundingVerified(manifest, ack, records),
  });
}

// -------------------------------------------------------------------------------------------------
// 7. Save

/** What the store keeps of the new vault, with its first manifest when there is one. */
export function candidateInput(vault: CreatedVault, name: string, manifest?: VaultManifest): VaultCandidateInput {
  const vaultName = vaultNameOf(name);
  return {
    vaultId: vault.vaultId,
    network: vault.network,
    origin: 'created',
    ...(vaultName !== undefined ? { name: vaultName } : {}),
    paymentScriptCbor: vault.scripts.payment.cbor,
    stakeScriptCbor: vault.scripts.stake.cbor,
    participants: [
      { role: 'owner', vaultKeys: vault.own.vaultKeys, self: true },
      ...vault.cosigners.map(c => ({ role: 'owner' as const, vaultKeys: c.vaultKeys, label: c.label })),
    ],
    ownIndex: vault.own.index,
    ...(manifest ? { manifest: encodeManifest(manifest) } : {}),
  };
}

/** Save refused because another vault of this wallet took its index since the setup began. */
export class IndexTakenError extends Error {
  readonly code = 'INDEX_TAKEN';

  constructor() {
    super('Another vault of this wallet holds this index');
    this.name = 'IndexTakenError';
  }
}

/**
 * Stores the vault as a candidate and accepts it with this device's verification records.
 *
 * The index is checked again against what the store holds now: another tab of this wallet may
 * have saved a vault at the same index since this setup allocated it, and two vaults must never
 * share this wallet's keys. A candidate left by an earlier attempt of this flow (origin `created`)
 * that failed between the two writes is accepted now; a restored or imported candidate of the
 * same vault is not taken over, and a vault already accepted is not written again.
 */
export async function saveCreatedVault(
  store: VaultStore,
  walletId: number,
  input: VaultCandidateInput,
  verifications: readonly CosignerVerification[],
): Promise<VaultRecord> {
  const held = await store.list(walletId);
  if (held.some(record => record.vaultId !== input.vaultId && record.ownIndex === input.ownIndex)) throw new IndexTakenError();
  try {
    await store.addCandidate(walletId, input);
  } catch (error) {
    if ((error as { code?: string })?.code !== 'VAULT_EXISTS') throw error;
    const existing = await store.get(walletId, input.vaultId);
    if (existing?.status !== 'candidate' || existing.origin !== 'created') throw error;
  }
  return store.accept(walletId, input.vaultId, { verifications });
}
