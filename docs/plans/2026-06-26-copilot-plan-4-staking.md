# Gero Copilot - Plan 4: Staking Actions (delegate + claim rewards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** "delegate to GERO" and "claim my rewards" as Guardrail-gated, propose-then-sign agent actions in the dock. Unlike swap/perps, these are **buildable end-to-end now** (claim-rewards via the live `nexusTxApi.buildWithdrawalTx`; delegate via the existing client-side cert builder), so they are genuinely shippable. Lands in both surfaces via the shared dock.

**Architecture:** Same spine as Plan 3. The agent emits a structured intent (delegate to a pool ticker; claim rewards). The wallet resolves the pool ticker -> `pool_id_bech32` (via `stakingStore`), reads the withdrawable amount from `walletStore.account`, builds the tx (client cert builder for delegate; `buildWithdrawalTx` for claim), then a **staking Guardrail decodes the tx and verifies**: a delegation cert targets the intended pool and there is no withdrawal/foreign outflow; or a withdrawal returns rewards to an own address, does not exceed the withdrawable amount, and carries no delegation cert or foreign outflow. Signable only on a passing verdict; sign via the universal `SIGN_TX` -> `SUBMIT_TX` path; no auto-sign.

**Tech Stack:** Vue 2.7 + TS, Vitest 3.2.4. Reuses: `deserializeCardanoJsSdkTx`, `stakingStore.loadPoolsPaginated`, `walletStore.account.withdrawable_amount`, `nexusTxApi.buildWithdrawalTx`, the client cert builder used by `useDelegation`, the universal sign path (`SIGN_TX`/`SUBMIT_TX`), `walletStore.keys` (payment+change own addresses).

**Backend status:** claim-rewards build is LIVE (`buildWithdrawalTx`, feature-flagged `isNexusWithdrawalEnabled`); delegate build is client-side (no backend dependency). So this plan is buildable AND live-capable (subject to the withdrawal feature flag). Perps + card controls are a SEPARATE later slice (perps gated on the 2.7 Strike auth fixes; not in this plan).

**Safety invariants:** agent supplies only the intent (pool ticker / "claim"); the wallet resolves the pool id and reads the withdrawable amount; the Guardrail verifies the decoded tx (cert pool id, withdrawal own-address + amount, no foreign outflow, no mixed cert+withdrawal); no auto-sign; CBOR opaque to sign/submit.

**Testing:** pure-TS units (intent, Guardrail, adapter, resolver, orchestration) are TDD; the `.vue` card + dock wiring verified by typecheck + build. Run a single spec with `npx vitest run <path>`.

---

### Task 1: Staking intent parser

**Files:** Create `src/services/agent/stakingIntent.ts` + `.spec.ts`.

- [ ] **Step 1: failing test**

```typescript
// src/services/agent/stakingIntent.spec.ts
import { describe, it, expect } from 'vitest';
import { parseStakingIntent } from './stakingIntent';

describe('parseStakingIntent', () => {
  it('parses delegate-to-pool', () => {
    expect(parseStakingIntent('delegate to GERO')).toEqual({ type: 'delegate', poolSymbol: 'GERO' });
    expect(parseStakingIntent('stake with adapools')).toEqual({ type: 'delegate', poolSymbol: 'ADAPOOLS' });
  });
  it('parses claim-rewards', () => {
    expect(parseStakingIntent('claim my rewards')).toEqual({ type: 'claimRewards' });
    expect(parseStakingIntent('withdraw my staking rewards')).toEqual({ type: 'claimRewards' });
  });
  it('returns null otherwise', () => {
    expect(parseStakingIntent('what is my balance')).toBeNull();
    expect(parseStakingIntent('swap 1 ada for gero')).toBeNull();
  });
});
```

- [ ] **Step 2:** run-fail (`npx vitest run src/services/agent/stakingIntent.spec.ts`).
- [ ] **Step 3: implement**

```typescript
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
```

- [ ] **Step 4:** run-pass. **Step 5:** commit `feat(copilot): staking intent parser (delegate / claim rewards)`.

---

### Task 2: Staking Guardrail (the safety core)

**Files:** Create `src/services/agent/stakingGuardrail.ts` + `.spec.ts`.

> Pure functions over an already-decoded structural tx (`{ certificates, withdrawals, outputs, fee }`). The caller decodes via `deserializeCardanoJsSdkTx` + an adapter (Task 3). Two verifiers: delegate + withdraw. Adversarial tests must cover: wrong pool, withdrawal sneaked into a delegate tx, foreign outflow, over-withdraw, delegation cert sneaked into a withdraw tx, withdrawal to a foreign address.

- [ ] **Step 1: failing test**

```typescript
// src/services/agent/stakingGuardrail.spec.ts
import { describe, it, expect } from 'vitest';
import { verifyDelegateTx, verifyWithdrawTx, type DecodedStakeTx } from './stakingGuardrail';

const OWN = 'addr_own';
const FOREIGN = 'addr_foreign';
const STAKE = 'stake_own';

const delegTx = (poolId: string, extra: Partial<DecodedStakeTx> = {}): DecodedStakeTx => ({
  certificates: [{ kind: 'StakeDelegation', poolId }],
  withdrawals: [],
  outputs: [{ address: OWN, lovelace: 9_000000n, hasAssets: false }],
  fee: 200000n,
  ...extra,
});

describe('verifyDelegateTx', () => {
  const exp = { ownAddresses: [OWN], targetPoolId: 'pool1good', maxFeeLovelace: 2_000000n };
  it('passes when the delegation cert targets the intended pool', () => {
    expect(verifyDelegateTx(delegTx('pool1good'), exp).ok).toBe(true);
  });
  it('FAILS when the cert targets a different pool', () => {
    const v = verifyDelegateTx(delegTx('pool1EVIL'), exp);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/different pool/i);
  });
  it('FAILS when no delegation cert is present', () => {
    expect(verifyDelegateTx(delegTx('pool1good', { certificates: [] }), exp).ok).toBe(false);
  });
  it('FAILS when a reward withdrawal is sneaked in', () => {
    const v = verifyDelegateTx(delegTx('pool1good', { withdrawals: [{ stakeAddress: STAKE, quantity: 5_000000n }] }), exp);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/should not.*withdraw/i);
  });
  it('FAILS on foreign ADA outflow', () => {
    const v = verifyDelegateTx(delegTx('pool1good', { outputs: [{ address: FOREIGN, lovelace: 50_000000n, hasAssets: false }] }), exp);
    expect(v.ok).toBe(false);
  });
});

describe('verifyWithdrawTx', () => {
  const exp = { ownAddresses: [OWN], stakeAddress: STAKE, withdrawableAmount: 5_000000n, maxFeeLovelace: 1_000000n };
  const wTx = (extra: Partial<DecodedStakeTx> = {}): DecodedStakeTx => ({
    certificates: [], withdrawals: [{ stakeAddress: STAKE, quantity: 5_000000n }],
    outputs: [{ address: OWN, lovelace: 12_000000n, hasAssets: false }], fee: 200000n, ...extra,
  });
  it('passes a clean rewards withdrawal to an own address', () => {
    expect(verifyWithdrawTx(wTx(), exp).ok).toBe(true);
  });
  it('FAILS when the withdrawal exceeds the available rewards', () => {
    const v = verifyWithdrawTx(wTx({ withdrawals: [{ stakeAddress: STAKE, quantity: 9_000000n }] }), exp);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/exceeds/i);
  });
  it('FAILS when ADA leaves to a foreign address', () => {
    const v = verifyWithdrawTx(wTx({ outputs: [{ address: FOREIGN, lovelace: 12_000000n, hasAssets: false }] }), exp);
    expect(v.ok).toBe(false);
  });
  it('FAILS when a delegation cert is sneaked into a withdraw', () => {
    const v = verifyWithdrawTx(wTx({ certificates: [{ kind: 'StakeDelegation', poolId: 'pool1x' }] }), exp);
    expect(v.ok).toBe(false);
  });
});
```

- [ ] **Step 2:** run-fail. **Step 3: implement**

```typescript
// src/services/agent/stakingGuardrail.ts
export interface StakeCert { kind: string; poolId?: string }
export interface StakeWithdrawal { stakeAddress: string; quantity: bigint }
export interface StakeOutput { address: string; lovelace: bigint; hasAssets: boolean }
export interface DecodedStakeTx {
  certificates: StakeCert[];
  withdrawals: StakeWithdrawal[];
  outputs: StakeOutput[];
  fee: bigint;
}
export interface DelegateExpectation { ownAddresses: string[]; targetPoolId: string; maxFeeLovelace: bigint }
export interface WithdrawExpectation { ownAddresses: string[]; stakeAddress: string; withdrawableAmount: bigint; maxFeeLovelace: bigint }
export interface StakeVerdict { ok: boolean; reasons: string[] }

const DELEG_KINDS = new Set(['StakeDelegation', 'StakeVoteDelegation', 'StakeVoteRegistrationDelegation', 'StakeRegistrationDelegation']);

function foreignLovelace(tx: DecodedStakeTx, own: Set<string>): { ada: bigint; tokens: boolean } {
  let ada = 0n;
  let tokens = false;
  for (const o of tx.outputs) {
    if (own.has(o.address)) continue;
    ada += o.lovelace;
    if (o.hasAssets) tokens = true;
  }
  return { ada, tokens };
}

/** Verify a delegation tx: one delegation cert to the intended pool, no withdrawal, no foreign outflow beyond fee. */
export function verifyDelegateTx(tx: DecodedStakeTx, exp: DelegateExpectation): StakeVerdict {
  const reasons: string[] = [];
  const own = new Set(exp.ownAddresses);
  const deleg = tx.certificates.find((c) => DELEG_KINDS.has(c.kind));
  if (!deleg || !deleg.poolId) reasons.push('No delegation certificate found in this transaction.');
  else if (deleg.poolId !== exp.targetPoolId) reasons.push('This would delegate to a different pool than you asked for.');
  if (tx.withdrawals.length > 0) reasons.push('A delegation should not also withdraw rewards.');
  const f = foreignLovelace(tx, own);
  if (f.tokens) reasons.push('This delegation would send tokens out of your wallet.');
  if (f.ada > exp.maxFeeLovelace) reasons.push('More ADA would leave your wallet than the expected fee.');
  return { ok: reasons.length === 0, reasons };
}

/** Verify a rewards withdrawal: withdrawal of the own stake address, within the withdrawable amount, no delegation cert, no foreign outflow. */
export function verifyWithdrawTx(tx: DecodedStakeTx, exp: WithdrawExpectation): StakeVerdict {
  const reasons: string[] = [];
  const own = new Set(exp.ownAddresses);
  const w = tx.withdrawals.find((x) => x.stakeAddress === exp.stakeAddress);
  if (!w) reasons.push('This transaction does not withdraw your staking rewards.');
  else if (w.quantity > exp.withdrawableAmount) reasons.push('The withdrawal amount exceeds your available rewards.');
  if (tx.certificates.some((c) => DELEG_KINDS.has(c.kind))) reasons.push('A rewards withdrawal should not change your pool delegation.');
  const f = foreignLovelace(tx, own);
  if (f.tokens) reasons.push('This withdrawal would send tokens out of your wallet.');
  if (f.ada > exp.maxFeeLovelace) reasons.push('Your rewards would leave to an address that is not yours.');
  return { ok: reasons.length === 0, reasons };
}
```

- [ ] **Step 4:** run-pass (9 tests). **Step 5:** commit `feat(copilot): staking Guardrail (delegate + withdraw verify)`.

---

### Task 3: Decoded-staking-tx adapter

**Files:** Create `src/services/agent/decodeStakeTx.ts` + `.spec.ts`.

> Maps a deserialized `Cardano.Tx` to `DecodedStakeTx`. VERIFY the real cert/withdrawal shapes against `useDelegation.ts` / `useWithdrawal.ts` / `resolver.ts` before finalizing: certificates carry a `__typename` (e.g. `StakeDelegation`) and a `poolId`; withdrawals are a Map or array of `{ stakeAddress|rewardAccount, quantity }`. Map `__typename` -> `kind`, the pool id -> `poolId` (string), each output to `{ address, lovelace: value.coins, hasAssets: !!value.assets?.size }`. Keep it a pure function over a structural `Cardano.Tx`-like input (caller deserializes). Write the spec to lock the mapping for one delegation tx + one withdrawal tx; implement; commit `feat(copilot): Cardano.Tx -> DecodedStakeTx adapter`.

---

### Task 4: Pool resolver (ticker -> pool_id_bech32)

**Files:** Create `src/services/agent/poolResolver.ts` + `.spec.ts`.

> `resolvePoolSymbolToId(symbol)` searches `stakingStore.loadPoolsPaginated(wallet, { search })` and returns the first `pool_id_bech32` whose `ticker` matches case-insensitively, else null. Inject the search function for testability (mock returns `{ items: [{ ticker, pool_id_bech32 }] }`). VERIFY the real `stakingStore.loadPoolsPaginated` signature + the wallet arg it needs; the resolver's own surface stays `resolvePoolSymbolToId(symbol: string): Promise<string | null>`. Spec mocks the search; implement; commit `feat(copilot): pool ticker -> pool id resolver`.

---

### Task 5: Staking orchestration (`useAgentStaking`)

**Files:** Create `src/sidepanel/composables/useAgentStaking.ts` + `.spec.ts`.

> `createAgentStaking(deps)` -> `{ busy, error, proposal, prepare(intent) }` with injectable deps (`resolvePool`, `getWithdrawable`, `getStakeAddress`, `buildDelegate`, `buildWithdraw`, `decodeAndVerifyDelegate`, `decodeAndVerifyWithdraw`, `getOwnAddresses`). `prepare`:
> - delegate: `resolvePool(poolSymbol)` -> targetPoolId (null -> error "pool not found"); `buildDelegate(targetPoolId)` -> unsignedTxCbor; `decodeAndVerifyDelegate(cbor, ownAddresses, targetPoolId, maxFee)` -> verdict; proposal `{ kind:'delegate', status: ok?'ready':'blocked', poolSymbol, targetPoolId, unsignedTxCbor, reasons }`.
> - claimRewards: `getWithdrawable()` -> bigint (0 -> error "no rewards"); `getStakeAddress()`; `buildWithdraw(amount)` -> cbor; `decodeAndVerifyWithdraw(cbor, ownAddresses, stakeAddress, withdrawable, maxFee)` -> verdict; proposal `{ kind:'claimRewards', status, amount, unsignedTxCbor, reasons }`.
> - busy guard; never auto-sign; errors -> error ref.
> Spec mocks the deps; 3+ tests (ready delegate; blocked delegate when Guardrail fails; ready claim; no-rewards error; no auto-sign). Implement; commit `feat(copilot): staking orchestration composable`.

---

### Task 6: StakingCard + dock wiring + i18n + build

**Files:** Create `src/sidepanel/components/agent/StakingCard.vue`; modify `useAgentDock.ts` (+ spec if needed), `AgentDock.vue`, `us.ts`, `de.ts`.

> StakingCard mirrors SwapCard: builds the real `useAgentStaking` deps (resolvePool via `poolResolver`/`stakingStore`; getWithdrawable from `walletStore.account.withdrawable_amount`; getStakeAddress from `walletStore.loggedWallet.stakeAddress`; getOwnAddresses from `walletStore.keys` payment+change; buildDelegate via the client cert builder used in `useDelegation`; buildWithdraw via `nexusTxApi.buildWithdrawalTx`; decodeAndVerify* via `deserializeCardanoJsSdkTx` + `decodeStakeTx` + the staking Guardrail), calls `prepare(intent)` on mount, renders the proposal (delegate: pool ticker + id; claim: amount) + a Sign button enabled ONLY when `status==='ready'` (blocked shows reasons), and signs via the universal `SIGN_TX` -> `SUBMIT_TX` path (password path; PRF/hardware documented follow-up). In `useAgentDock`, attach a `staking` intent (`{ type:'staking'; staking: StakingIntent }`) when `parseStakingIntent` matches (after the swap branch). AgentDock renders `<StakingCard>` for it (both surfaces). Add `copilot.staking.*` i18n keys to us.ts + de.ts. `npm run typecheck` (no new errors), `npm run lint` (clean), `npm run build` (must pass). Commit `feat(copilot): StakingCard + dock wiring + i18n (delegate + claim rewards)`.

---

## Self-Review

- **Buildable end-to-end:** claim-rewards uses the live `buildWithdrawalTx`; delegate uses the client cert builder; both sign/submit via the universal path. No missing backend (subject to the withdrawal feature flag).
- **Safety:** the agent supplies only the pool ticker / "claim"; the wallet resolves the pool id and reads the withdrawable amount; the Guardrail blocks wrong-pool, over-withdraw, foreign outflow, mixed cert+withdrawal, and withdrawal-to-foreign. No auto-sign; CBOR opaque.
- **Both surfaces:** StakingCard renders in the shared dock.
- **Verification flags:** confirm the real Cardano cert/withdrawal shapes (Task 3), `stakingStore.loadPoolsPaginated` signature (Task 4), the client cert builder call (`buildCardanoTransaction`) used by `useDelegation` (Task 6), and `walletStore.account.withdrawable_amount` + `loggedWallet.stakeAddress` (Tasks 5-6).
- **Out of scope (separate later slice):** perps (gated on the 2.7 Strike auth fixes), card controls (Kaiserex API), DRep/governance delegation (Conway vote certs) - delegate handles the standard pool-delegation cert; governance vote-delegation is a follow-up.
