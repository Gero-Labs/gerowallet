// src/services/agent/allowancePolicy.ts
export type AllowanceStatus = 'active' | 'paused' | 'revoked';

export interface AllowanceConfig {
  status: AllowanceStatus;
  totalBudgetLovelace: bigint;
  perPaymentCapLovelace: bigint;
  dailyCapLovelace: bigint;
  allowlistPayees: string[];
  allowlistCategories: string[];
  expiresAt: number; // ms epoch
}
export interface SpendRecord { ts: number; amountLovelace: bigint }
export interface PaymentRequest { payee: string; category: string; amountLovelace: bigint }
export interface PaymentVerdict {
  allowed: boolean;
  reasons: string[];
  remaining: { total: bigint; today: bigint; perPayment: bigint };
}

const DAY_MS = 86_400_000;

function sumSince(ledger: SpendRecord[], sinceTs: number): bigint {
  let s = 0n;
  for (const r of ledger) if (r.ts >= sinceTs) s += r.amountLovelace;
  return s;
}
function sumAll(ledger: SpendRecord[]): bigint {
  let s = 0n;
  for (const r of ledger) s += r.amountLovelace;
  return s;
}

/**
 * Deterministically decide whether an agent payment is permitted by the leash.
 * Default-deny: the payee or the category must be explicitly allowlisted. "Daily" is a
 * rolling 24h window from `now`. The agent supplies the request; it never supplies the
 * config or the ledger (those are user-owned + wallet-recorded), so it cannot widen its
 * own limits. All arithmetic is exact bigint.
 */
export function evaluatePayment(
  req: PaymentRequest,
  config: AllowanceConfig,
  ledger: SpendRecord[],
  now: number,
): PaymentVerdict {
  const reasons: string[] = [];
  const spentToday = sumSince(ledger, now - DAY_MS);
  const spentTotal = sumAll(ledger);
  const remaining = {
    total: config.totalBudgetLovelace - spentTotal,
    today: config.dailyCapLovelace - spentToday,
    perPayment: config.perPaymentCapLovelace,
  };

  if (config.status !== 'active') reasons.push('Your agent allowance is paused or revoked.');
  if (now > config.expiresAt) reasons.push('Your agent allowance has expired.');

  const payeeOk = config.allowlistPayees.includes(req.payee);
  const categoryOk = config.allowlistCategories.includes(req.category);
  if (!payeeOk && !categoryOk) reasons.push('This recipient is not on your allow-list.');

  if (req.amountLovelace > config.perPaymentCapLovelace) reasons.push('This payment is over your per-payment cap.');
  if (spentToday + req.amountLovelace > config.dailyCapLovelace) reasons.push('This payment would exceed your daily limit.');
  if (spentTotal + req.amountLovelace > config.totalBudgetLovelace) reasons.push('This payment would exceed your total budget.');

  return { allowed: reasons.length === 0, reasons, remaining };
}
