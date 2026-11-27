import { decodeRewardAccountBytes, type RewardAccountView } from './address';
import { readBytes, readDistinctMap, readUint, type Bytes } from './cbor';
import type { DecodeContext } from './context';
import { FieldRefusal } from './refusals';

/**
 * Reward withdrawals (body key 5): `{ reward_account => coin }`. Each is rendered with the full
 * reward address it draws from and the amount. An account listed twice is `field_malformed`.
 */

export interface WithdrawalView {
  rewardAccount: RewardAccountView;
  lovelace: bigint;
}

export function decodeWithdrawals(item: Bytes, path: string, ctx: DecodeContext): WithdrawalView[] {
  const views: WithdrawalView[] = [];
  const entries = readDistinctMap(item, path, (key) => readBytes(key, path));
  if (entries.length === 0) throw new FieldRefusal('field_malformed', path, 'empty');
  entries.forEach(([account, value], i) => {
    const at = `${path}[${i}]`;
    const view = ctx.refusals.guard(at, () => ({
      rewardAccount: decodeRewardAccountBytes(account, at, ctx.networkId),
      lovelace: readUint(value, at),
    }));
    if (view) views.push(view);
  });
  return views;
}
