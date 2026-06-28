# Gero Copilot - Plan 5: Agent Allowance (policy engine + config + UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the safe, buildable, testable core of the Agent Allowance - the "leash": a deterministic **policy engine** (per-payment / daily / total caps, default-deny allowlist, expiry), a persisted **config + spend-ledger** store, and a **management UI** (set up the allowance, see caps/remaining, view the spend receipts, pause/revoke). This makes the moat real - "bounded, revocable, you can always cut the leash" - while the **autonomous-spend execution + the funded sub-account are explicitly gated on new infra** (a separate funded account + an automated signing path that does not exist yet). Lands in both surfaces via the shared dock.

**Architecture:** A user configures an allowance (total budget, per-payment cap, daily cap, allowlisted payees/categories, expiry). When the agent wants to make a payment, the request is evaluated by the pure **policy engine** against the config + the recorded spend ledger; only an `allowed` verdict may proceed, and every recorded payment appends to the ledger (surfaced as receipts in the Feed). Escalations (raising a cap, topping up, extending) are user actions; de-escalations (pause, revoke, lower) are instant. The actual on-chain autonomous payment (signing from the funded sub-account) is OUT OF SCOPE here and gated - this plan builds the leash, the accounting, and the controls.

**Tech Stack:** Vue 2.7 + TS, Vitest 3.2.4. New pure modules + a Vue-observable store (mirroring `copilotFeedStore` from Plan 2) + a management UI surface + dock wiring. No backend dependency for the policy/config/UI core.

**Safety invariants (the leash):** default-deny (a payment must match an allowlisted payee OR category); hard caps enforced by exact bigint math against the recorded ledger; expiry fails closed; paused/revoked fails closed; the agent can never raise its own limits (escalations are user-signed actions, modeled here as explicit user calls). Worst case is bounded by the configured total budget.

**Scope and explicit deferrals:** IN - policy engine, config + ledger store (persisted, capped), management composable + UI, dock intents ("set up an agent allowance", "show my allowance"), receipts in the Feed, i18n. DEFERRED (gated on new infra, documented, NOT built here) - the funded sub-account key/derivation + funding flow; the automated signing path for autonomous payments; x402 / agent-to-agent execution; on-chain script-escrow (the L3 trustless variant). A typed `requestPayment` seam is defined so execution can be wired when the infra lands.

**Testing:** pure-TS units (policy engine, ledger reducers, composable logic) are TDD; the `.vue` UI + dock wiring verified by typecheck + build. Run a single spec with `npx vitest run <path>`.

---

### Task 1: Allowance policy engine (the leash - safety core)

**Files:** Create `src/services/agent/allowancePolicy.ts` + `.spec.ts`.

> Pure `evaluatePayment(req, config, ledger, now)` -> verdict. Default-deny. Exact bigint math. "Daily" is a rolling 24h window (timezone-free, `now`-injected). Adversarial tests must cover every deny path.

- [ ] **Step 1: failing test**

```typescript
// src/services/agent/allowancePolicy.spec.ts
import { describe, it, expect } from 'vitest';
import { evaluatePayment, type AllowanceConfig, type SpendRecord } from './allowancePolicy';

const DAY = 86_400_000;
const NOW = 1_000_000_000_000;

const cfg = (over: Partial<AllowanceConfig> = {}): AllowanceConfig => ({
  status: 'active',
  totalBudgetLovelace: 100_000000n,
  perPaymentCapLovelace: 10_000000n,
  dailyCapLovelace: 30_000000n,
  allowlistPayees: ['agentX'],
  allowlistCategories: ['data'],
  expiresAt: NOW + DAY,
  ...over,
});

const req = (over: Partial<{ payee: string; category: string; amountLovelace: bigint }> = {}) => ({
  payee: 'agentX', category: 'data', amountLovelace: 5_000000n, ...over,
});

describe('evaluatePayment', () => {
  it('allows a payment within all limits to an allowlisted payee', () => {
    const v = evaluatePayment(req(), cfg(), [], NOW);
    expect(v.allowed).toBe(true);
  });
  it('denies when the allowance is paused/revoked', () => {
    expect(evaluatePayment(req(), cfg({ status: 'paused' }), [], NOW).allowed).toBe(false);
    expect(evaluatePayment(req(), cfg({ status: 'revoked' }), [], NOW).allowed).toBe(false);
  });
  it('denies when expired', () => {
    const v = evaluatePayment(req(), cfg(), [], NOW + 2 * DAY);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/expired/i);
  });
  it('denies a payee/category not on the allowlist (default-deny)', () => {
    const v = evaluatePayment(req({ payee: 'evil', category: 'other' }), cfg(), [], NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/not on your allow/i);
  });
  it('allows when the category matches even if the payee does not', () => {
    expect(evaluatePayment(req({ payee: 'unknown', category: 'data' }), cfg(), [], NOW).allowed).toBe(true);
  });
  it('denies when over the per-payment cap', () => {
    const v = evaluatePayment(req({ amountLovelace: 11_000000n }), cfg(), [], NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/per-payment/i);
  });
  it('denies when this payment would exceed the rolling 24h daily cap', () => {
    const ledger: SpendRecord[] = [{ ts: NOW - 1000, amountLovelace: 28_000000n }];
    const v = evaluatePayment(req({ amountLovelace: 5_000000n }), cfg(), ledger, NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/daily/i);
  });
  it('ignores spend older than 24h for the daily cap', () => {
    const ledger: SpendRecord[] = [{ ts: NOW - 2 * DAY, amountLovelace: 28_000000n }];
    expect(evaluatePayment(req({ amountLovelace: 5_000000n }), cfg(), ledger, NOW).allowed).toBe(true);
  });
  it('denies when this payment would exceed the total budget', () => {
    const ledger: SpendRecord[] = [{ ts: NOW - 3 * DAY, amountLovelace: 98_000000n }];
    const v = evaluatePayment(req({ amountLovelace: 5_000000n }), cfg(), ledger, NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/total budget/i);
  });
});
```

- [ ] **Step 2:** run-fail. **Step 3: implement**

```typescript
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
```

- [ ] **Step 4:** run-pass (9 tests). **Step 5:** commit `feat(copilot): agent allowance policy engine (the leash)`.

---

### Task 2: Ledger reducers (record + cap)

**Files:** Create `src/services/agent/allowanceLedger.ts` + `.spec.ts`.

> Pure helpers the store uses: `recordSpend(ledger, record, maxRecords)` (append newest-first, cap), `spentInWindow(ledger, sinceTs)`, `spentTotal(ledger)`. (The policy engine has its own internal sums; these are for the store/UI to display remaining + receipts and to keep the ledger bounded.) Tests: append + cap to maxRecords (drop oldest); window + total sums with bigint. Implement; commit `feat(copilot): agent allowance spend ledger reducers`.

---

### Task 3: Allowance store + management composable

**Files:** Create `src/stores/agentAllowanceStore.ts`, `src/sidepanel/composables/useAgentAllowance.ts` (+ a `.spec.ts` for the composable).

> `agentAllowanceStore`: a Vue-observable (mirror `copilotFeedStore` from Plan 2) holding `{ config: AllowanceConfig | null, ledger: SpendRecord[] }`, persisted to `chrome.storage.local` (debounced), with a `hasChromeStorage` guard. Methods: `setConfig(cfg)`, `patchConfig(partial)` (for escalations - user action), `pause()`, `resume()`, `revoke()` (sets status; revoke also clears nothing but blocks all), `recordSpend(record)` (uses `recordSpend` reducer, cap 100). bigint fields serialized as strings (reuse the bigint replacer pattern noted in CLAUDE.md store-broadcasting).
> `useAgentAllowance(deps?)`: exposes reactive `config`, `remaining` (computed via the policy/ledger helpers + `Date.now()`), `receipts` (the ledger), and actions `createAllowance(cfg)`, `updateLimits(partial)`, `pause/resume/revoke`, and a GATED `requestPayment(req): PaymentVerdict` that runs `evaluatePayment(req, config, ledger, Date.now())` and, on allow, records the spend (the ACTUAL on-chain execution is the gated infra - this seam returns the verdict + records intent only; add a clear doc-comment that execution is gated). Inject `now`/store for tests. Spec: createAllowance sets config; requestPayment denies when over a cap and allows + records within; pause blocks. Implement; commit `feat(copilot): agent allowance store + management composable (gated execution seam)`.

---

### Task 4: Allowance UI + dock wiring + receipts + i18n + build

**Files:** Create `src/sidepanel/components/agent/AllowanceCard.vue`; modify `useAgentDock.ts` (+spec if needed), `AgentDock.vue`, `us.ts`, `de.ts`. Optionally surface receipts in the Feed (`copilotFeedStore`) from `recordSpend`.

> AllowanceCard: if no allowance, a setup form (total budget, per-payment cap, daily cap, expiry, a simple allowlist of categories/payees) -> `createAllowance`; if configured, a status view (caps + remaining gauges, expiry, the receipts list) with **Pause** / **Resume** / **Revoke** / **Adjust limits** controls. A clear banner: "Autonomous payments are not yet enabled - this sets the limits the agent will operate under." (honest about the gated execution.) `$t` labels + not-advice/limits framing. In `useAgentDock`, add a `{ type: 'allowance' }` intent when the text matches "set up an agent allowance" / "show my allowance" / "agent allowance" (a new `parseAllowanceIntent`). AgentDock renders `<AllowanceCard>` for it (both surfaces). Add `copilot.allowance.*` i18n keys to us.ts + de.ts. When a spend is recorded, append a receipt line to the Feed (reuse `copilotFeedStore.merge` with an `allowance-receipt` item) so receipts are transparent.
> Verify: `npm run typecheck` (no new errors), `npm run lint` (clean), `npm run build` (must pass). Commit `feat(copilot): agent allowance UI + dock wiring + receipts + i18n`.

---

## Self-Review

- **Buildable + valuable now:** the leash (policy engine), the accounting (ledger + store), and the controls (UI: set/pause/revoke/adjust) are all built + TDD-tested with no backend dependency. This is the moat: bounded, revocable, transparent.
- **Honest gating:** the autonomous on-chain execution + the funded sub-account are explicitly out of scope and surfaced to the user ("autonomous payments not yet enabled"); the `requestPayment` seam is typed so execution wires in when the infra lands.
- **Safety:** default-deny allowlist; exact-bigint caps against the recorded ledger; expiry + paused/revoke fail closed; the agent supplies only the request, never the config/ledger, so it cannot widen its own limits; worst case bounded by the total budget.
- **Both surfaces:** AllowanceCard renders in the shared dock; receipts surface in the shared Feed.
- **Verification flags:** confirm the `copilotFeedStore` shape for receipt items (Task 4); confirm the Vue-observable + chrome.storage bigint-serialization pattern from `copilotFeedStore`/walletStore (Task 3).
- **Deferred (gated infra, documented):** funded sub-account + key derivation; automated signing; x402/A2A execution; on-chain script-escrow (L3). These are a separate infrastructure project, flagged for when the backend/key infra exists.
