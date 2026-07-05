// src/services/agent/stakingIntent.ts
export type StakingIntent = { type: 'delegate'; poolSymbol: string } | { type: 'claimRewards' };

const DELEGATE_RE = /\b(?:delegate to|stake with|delegate my stake to)\s+([a-z0-9]{2,16})\b/i;
const CLAIM_RE = /\b(?:claim|withdraw)\b(?:\s+my)?(?:\s+staking)?\s+rewards?\b/i;

export function parseStakingIntent(text: string): StakingIntent | null {
  const t = text || '';
  if (CLAIM_RE.test(t)) return { type: 'claimRewards' };
  const d = DELEGATE_RE.exec(t);
  if (d) return { type: 'delegate', poolSymbol: d[1].toUpperCase() };
  return null;
}
