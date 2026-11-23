import axios from 'axios';
import { Cardano } from '@cardano-sdk/core';
import { KOIOS_URLS } from './spo-api';
import { Network } from '@/models/types';
import { SLOTS_PER_EPOCH } from '@/shared/utils/transaction';
import { toDisplayGovActionId, type GovActionId } from '@/shared/utils/govActionId';

interface StakeUpdate {
  action_type: string;
  tx_hash: string;
  block_time: number;
}

interface AccountUpdates {
  stake_address: string;
  updates: StakeUpdate[];
}

interface Proposal {
  proposal_tx_hash: string;
  proposal_index: number;
  block_time: number;
  expiration: number;
  ratified_epoch: number | null;
  enacted_epoch: number | null;
  dropped_epoch: number | null;
  expired_epoch: number | null;
}

interface TxInfo {
  tx_hash: string;
  tx_block_index: number;
  certificates: { type: string; index: number; info: { stake_address?: string } }[];
}

interface Tip {
  abs_slot: number;
  epoch_slot: number;
  epoch_no: number;
}

function natural(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Missing chain position');
  return value;
}

/** A ratified action can still take answers in its ratification epoch. */
function closingEpoch(proposal: Proposal): number {
  const limits = [natural(proposal.expiration)];
  if (proposal.ratified_epoch !== null) limits.push(natural(proposal.ratified_epoch) + 1);
  for (const epoch of [proposal.enacted_epoch, proposal.dropped_epoch, proposal.expired_epoch]) {
    if (epoch !== null) limits.push(natural(epoch));
  }
  return Math.min(...limits);
}

/** Registration and submission are ordered by transaction inside a block. Multiple
 * registration certificates inside one transaction are ordered by certificate index. */
async function registrationBefore(
  accounts: AccountUpdates[], stakeAddress: string, proposals: Proposal[],
  getTxInfo: (hashes: string[]) => Promise<TxInfo[]>,
): Promise<(proposal: Proposal) => boolean> {
  if (!Array.isArray(accounts)) throw new Error('Missing stake history');
  if (!accounts.length) return () => false;
  if (accounts.length !== 1 || accounts[0].stake_address !== stakeAddress) throw new Error('Unexpected stake history');
  const changes = accounts[0].updates.filter(u => u.action_type === 'registration' || u.action_type === 'deregistration');
  if (!changes.length) return () => false;
  // Both supported networks have one-second slots. Equal block times need the
  // transaction position; a registration in the proposal transaction is too late.
  const time = changes.reduce((max, u) => Math.max(max, natural(u.block_time)), 0);
  const latest = changes.filter(update => update.block_time === time);
  const tied = proposals.filter(proposal => proposal.block_time === time);
  if (latest.length === 1 && (!tied.length || latest[0].action_type === 'deregistration')) {
    return proposal => latest[0].action_type === 'registration' && time < proposal.block_time;
  }

  const hashes = [...new Set([...latest.map(update => update.tx_hash), ...tied.map(proposal => proposal.proposal_tx_hash)])];
  const rows = await getTxInfo(hashes);
  const txs = new Map(rows.map(tx => [tx.tx_hash, tx]));
  for (const hash of hashes) natural(txs.get(hash)?.tx_block_index);
  const last = latest.map(update => txs.get(update.tx_hash)).reduce((a, b) =>
    a.tx_block_index > b.tx_block_index ? a : b);
  const certificates = last.certificates.filter(cert => cert.info?.stake_address === stakeAddress &&
    (cert.type === 'stake_registration' || cert.type === 'stake_deregistration'));
  if (!certificates.length) throw new Error('Missing stake certificate');
  for (const cert of certificates) natural(cert.index);
  const finalCert = certificates.reduce((a, b) => a.index > b.index ? a : b);
  return proposal => finalCert.type === 'stake_registration' && (time < proposal.block_time ||
    (time === proposal.block_time && last.tx_block_index < txs.get(proposal.proposal_tx_hash).tx_block_index));
}

/** Read only on review. The wallet's current delegation cannot prove continuous registration. */
export async function checkHolderAnswers(stakeAddress: string, network: string, ids: GovActionId[]) {
  if (network !== Network.MAINNET && network !== Network.PREPROD) throw new Error('Unsupported governance network');
  const client = axios.create({ baseURL: KOIOS_URLS[network], timeout: 15000 });
  const hashes = [...new Set(ids.map(id => id.txHash))];
  const [tipResponse, proposalsResponse, accountResponse] = await Promise.all([
    client.get<Tip[]>('/tip', { params: { select: 'abs_slot,epoch_slot,epoch_no' } }),
    client.get<Proposal[]>('/proposal_list', { params: {
      proposal_tx_hash: `in.(${hashes.join(',')})`,
      select: 'proposal_tx_hash,proposal_index,block_time,expiration,ratified_epoch,enacted_epoch,dropped_epoch,expired_epoch',
    } }),
    client.post<AccountUpdates[]>('/account_updates', { _stake_addresses: [stakeAddress] }),
  ]);
  const [tip] = tipResponse.data;
  const slot = natural(tip.abs_slot);
  const epoch = natural(tip.epoch_no);
  const epochSlot = natural(tip.epoch_slot);
  if (epochSlot >= SLOTS_PER_EPOCH || slot < epochSlot) throw new Error('Invalid epoch position');
  const proposals = proposalsResponse.data;
  const registeredBefore = await registrationBefore(accountResponse.data, stakeAddress, proposals, async txHashes =>
    (await client.post<TxInfo[]>('/tx_info', { _tx_hashes: txHashes, _certs: true },
      { params: { select: 'tx_hash,tx_block_index,certificates' } })).data);

  const blocked = [];
  for (const id of ids) {
    const action = proposals.find(p => p.proposal_tx_hash === id.txHash && p.proposal_index === id.index);
    if (!action || closingEpoch(action) <= epoch) {
      blocked.push({ id: toDisplayGovActionId(id), reason: 'governance.holderClosed' });
    } else {
      natural(action.block_time);
      if (!registeredBefore(action)) blocked.push({ id: toDisplayGovActionId(id), reason: 'governance.holderRegistration' });
    }
  }
  // Any still-live action can close at the next epoch transition. Never allow
  // a reviewed answer past that boundary, even if early enactment is not yet indexed.
  return { blocked, slot, invalidHereafter: Cardano.Slot(slot - epochSlot + SLOTS_PER_EPOCH) };
}
