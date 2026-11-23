import { Cardano } from '@cardano-sdk/core';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { hexToBytes } from '@noble/hashes/utils.js';
import { parseGovActionId, toDisplayGovActionId } from './govActionId';
import { voteFromChoice, type VoteIntent } from './voteBuilder';

/** CIP-0204 v1. Hashes are CBOR byte strings and map keys and choices are integers. */
export function holderAnswerFields(stakeKeyHash: string, answers: VoteIntent[]) {
  const signer = Ed25519KeyHashHex(stakeKeyHash);
  if (!answers.length) throw new Error('A holder answer transaction needs at least one answer');
  const ids = new Set<string>();
  const entries = answers.map(({ govActionId, choice }) => {
    const id = parseGovActionId(govActionId);
    if (!id || id.index > 0xffff) throw new Error('Invalid holder answer action ID');
    const canonical = toDisplayGovActionId(id);
    if (ids.has(canonical)) throw new Error('Duplicate holder answer action ID');
    ids.add(canonical);
    return [[hexToBytes(id.txHash), BigInt(id.index)], BigInt(voteFromChoice(choice))];
  });
  const record = new Map<bigint, Cardano.Metadatum>([
    [0n, 1n],
    [1n, [0n, hexToBytes(signer)]],
    [2n, entries],
  ]);
  const auxiliaryData: Cardano.AuxiliaryData = { blob: new Map([[1695n, record]]) };
  return { auxiliaryData, requiredExtraSignatures: [signer] };
}
