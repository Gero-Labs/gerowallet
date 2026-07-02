// src/sidepanel/composables/useAgentAllowance.ts
import { computed, type ComputedRef } from 'vue';
import { agentAllowanceStore } from '@/stores/agentAllowanceStore';
import { evaluatePayment } from '@/services/agent/allowancePolicy';
import { spentInWindow, spentTotal } from '@/services/agent/allowanceLedger';
import type { AllowanceConfig, PaymentRequest, PaymentVerdict, SpendRecord } from '@/services/agent/allowancePolicy';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AllowanceValidationResult {
  ok: boolean;
  errors: string[];
}

export interface Remaining {
  total: bigint | null;
  today: bigint | null;
  perPayment: bigint | null;
}

interface AllowanceStoreLike {
  config: AllowanceConfig | null;
  ledger: SpendRecord[];
  setConfig(cfg: AllowanceConfig): void;
  patchConfig(partial: Partial<AllowanceConfig>): void;
  pause(): void;
  resume(): void;
  revoke(): void;
  recordSpend(record: SpendRecord): void;
  clear(): void;
}

export interface AgentAllowanceDeps {
  store?: AllowanceStoreLike;
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateConfig(cfg: Omit<AllowanceConfig, 'status'>, now: number): string[] {
  const errors: string[] = [];

  if (cfg.totalBudgetLovelace <= 0n) errors.push('Total budget must be greater than zero.');
  if (cfg.perPaymentCapLovelace <= 0n) errors.push('Per-payment cap must be greater than zero.');
  if (cfg.dailyCapLovelace <= 0n) errors.push('Daily cap must be greater than zero.');

  const bothEmpty = cfg.allowlistPayees.length === 0 && cfg.allowlistCategories.length === 0;
  if (bothEmpty) errors.push('The allow-list must have at least one payee or category.');

  const hasWildcard = cfg.allowlistCategories.includes('*');
  if (hasWildcard) errors.push('Wildcard category "*" is not permitted - specify explicit categories.');

  if (cfg.expiresAt <= now) errors.push('Expiry must be in the future.');

  return errors;
}

// ---------------------------------------------------------------------------
// Composable factory
// ---------------------------------------------------------------------------

/**
 * Management composable for the agent allowance (the leash).
 *
 * IMPORTANT: `requestPayment` evaluates the policy and records spend intent ONLY.
 * The ACTUAL autonomous on-chain payment execution requires a funded sub-account
 * and an automated signing path that are explicitly deferred to a future
 * infrastructure milestone. This seam returns the verdict + records intent so
 * execution can be wired when that infra lands. It NEVER executes a real payment.
 */
export function createAgentAllowance(deps: AgentAllowanceDeps = {}) {
  const store = deps.store ?? agentAllowanceStore;
  const now = deps.now ?? (() => Date.now());

  // -------------------------------------------------------------------------
  // Reactive refs (accessed via store getters which are Vue-observable)
  // -------------------------------------------------------------------------

  const config: ComputedRef<AllowanceConfig | null> = computed(() => store.config);
  const receipts: ComputedRef<SpendRecord[]> = computed(() => store.ledger);

  const remaining: ComputedRef<Remaining> = computed(() => {
    const cfg = store.config;
    if (!cfg) return { total: null, today: null, perPayment: null };
    const ts = now();
    const total = cfg.totalBudgetLovelace - spentTotal(store.ledger);
    const today = cfg.dailyCapLovelace - spentInWindow(store.ledger, ts - DAY_MS);
    return { total, today, perPayment: cfg.perPaymentCapLovelace };
  });

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  function createAllowance(cfg: Omit<AllowanceConfig, 'status'>): AllowanceValidationResult {
    const errors = validateConfig(cfg, now());
    if (errors.length > 0) return { ok: false, errors };
    store.setConfig({ ...cfg, status: 'active' });
    return { ok: true, errors: [] };
  }

  function updateLimits(partial: Partial<Pick<AllowanceConfig, 'totalBudgetLovelace' | 'perPaymentCapLovelace' | 'dailyCapLovelace' | 'expiresAt' | 'allowlistPayees' | 'allowlistCategories'>>): void {
    store.patchConfig(partial);
  }

  function pause(): void {
    store.pause();
  }

  function resume(): void {
    store.resume();
  }

  function revoke(): void {
    store.revoke();
  }

  /**
   * Evaluate whether an agent payment is permitted by the leash.
   *
   * On an `allowed` verdict, the spend is recorded in the ledger so the caps
   * remain accurate. The ACTUAL on-chain autonomous payment execution is gated
   * on a funded sub-account + automated signing path (future infra - not built
   * here). This function NEVER executes or broadcasts a real transaction.
   */
  function requestPayment(req: PaymentRequest): PaymentVerdict {
    const cfg = store.config;
    if (!cfg) {
      return {
        allowed: false,
        reasons: ['No allowance configured - set up an agent allowance first.'],
        remaining: { total: 0n, today: 0n, perPayment: 0n },
      };
    }
    const verdict = evaluatePayment(req, cfg, store.ledger, now());
    if (verdict.allowed) {
      store.recordSpend({ ts: now(), amountLovelace: req.amountLovelace });
    }
    return verdict;
  }

  return {
    config,
    remaining,
    receipts,
    createAllowance,
    updateLimits,
    pause,
    resume,
    revoke,
    requestPayment,
  };
}

export const agentAllowance = createAgentAllowance();
