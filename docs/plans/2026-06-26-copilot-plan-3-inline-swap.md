# Gero Copilot - Plan 3: Inline Swap (the first signed action) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user says "swap 100 ADA for GERO" in the agent dock, render a live swap card inline, and let the user sign locally - with a deterministic Guardrail that re-derives exactly what is being signed from the decoded CBOR and refuses if it does not match the intent. The agent prepares; the user commits. Works in both surfaces automatically (the dock is shared).

**Architecture:** The agent emits a structured swap intent (it never sets the asset or the amount that reaches the signer). The wallet re-resolves ticker -> assetId (reusing `resolveSymbolToAssetId`), computes the amount from the real balance, gets a Nexus aggregator quote, builds the unsigned tx, then the **Guardrail decodes that unsigned CBOR and verifies** the user receives at least the quoted minimum of the resolved output asset to their own address and that no unexpected outflow exists. Only on a passing verdict is the card signable. Signing reuses the existing `scanTx` + `SIGN_TX` (detached-witness, opaque body) + submit path. The unsigned CBOR is opaque (never re-serialized); submit is never retried.

**Tech Stack:** Vue 2.7 + TS + Vuetify 2.7, Vite, Vitest 3.2.4. Reuses: `resolveSymbolToAssetId` (Plan 1), `deserializeCardanoJsSdkTx` (`src/chrome/cardanoJsSdkCbor.ts`), `cardanoShieldApi.scanTx`, `MessageTypes.SIGN_TX` (`walletBg.signTx` -> `{ witnesses }`), `cardanoUtxoToNexusInput` (`src/api/nexus-tx-api.ts`), market-api.

**HARD prerequisite (backend, tracked separately):** the Nexus `/api/aggregator/{quote,build-tx,submit,status,tokens}` rail (documented in `docs/plans/2026-06-24-dexhunter-nexus-cutoff.md`) does NOT exist yet ("proposed, not started"). Unit tests in this plan mock the HTTP layer and do not need it; live swap execution is gated on that rail shipping. The Guardrail (the safety core) needs no backend - it operates on a decoded tx.

**Non-negotiable safety invariants (enforced by this plan):**
1. The agent emits a structured intent only; it never supplies the asset id or the amount that reaches the signer. The wallet re-resolves the ticker and computes the amount.
2. The unsigned CBOR is OPAQUE: pass it byte-for-byte to sign and submit; never re-serialize.
3. The Guardrail re-derives outputs from the decoded CBOR and must PASS before the card is signable. A mismatch (wrong output asset, output below the quoted minimum, an unexpected recipient, change not returning to an own address) blocks signing.
4. No auto-sign, ever. The user taps Sign. Submit is non-idempotent and never retried.
5. `scanTx` runs before the sign sheet; a high risk surfaces a blocking warning.

**Testing note:** Pure-TS units (client, intent, Guardrail, orchestration logic) are TDD with Vitest. The `.vue` card + dock wiring are verified with typecheck + build + manual (gated on the backend rail). Run a single spec with `npx vitest run <path>`.

**Scope and deferrals:** IN: market swaps (ADA<->token, token<->token) initiated from the dock, in both surfaces. DEFERRED: limit/DCA orders (Nexus market-only), reverse quotes ("buy X worth"), perps (Plan 4), the Agent Allowance / autonomous execution (Plan 5). v1 supports an explicit-amount swap and a "sell N% of my <token>" form (the percentage is computed by the wallet from the real balance, never by the agent).

---

### Task 1: Nexus aggregator client + types

**Files:**
- Create: `src/api/nexus-swap.api.ts`
- Test: `src/api/nexus-swap.api.spec.ts`

> Confirm `VITE_NEXUS_URL` env usage and the default-export/axios pattern against `src/api/market-api.ts` before writing. The endpoint paths and shapes follow `docs/plans/2026-06-24-dexhunter-nexus-cutoff.md` section 3.

- [ ] **Step 1: Write the failing test**

```typescript
// src/api/nexus-swap.api.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('nexus-swap aggregator client', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const mod = await import('./nexus-swap.api');
    expect(mod.swapAxiosInstance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('quote() posts to /api/aggregator/quote and returns routes', async () => {
    const mod = await import('./nexus-swap.api');
    const spy = vi.spyOn(mod.swapAxiosInstance, 'post').mockResolvedValue({
      data: { routes: [{ dex: 'MINSWAP', tokenIn: 'lovelace', tokenOut: 'abc', amountIn: '100', expectedOutput: '900', minimumOutput: '880' }], bestRouteIndex: 0 },
    } as never);
    const res = await mod.nexusSwapApi.quote({ tokenIn: 'lovelace', tokenOut: 'abc', amountIn: '100' });
    expect(spy).toHaveBeenCalledWith('/api/aggregator/quote', { tokenIn: 'lovelace', tokenOut: 'abc', amountIn: '100' });
    expect(res.routes[0].minimumOutput).toBe('880');
    expect(res.bestRouteIndex).toBe(0);
  });

  it('buildTx() posts the route + utxos and returns the opaque unsignedTxCbor', async () => {
    const mod = await import('./nexus-swap.api');
    const spy = vi.spyOn(mod.swapAxiosInstance, 'post').mockResolvedValue({
      data: { unsignedTxCbor: 'deadbeef', txBodyHash: 'h', aggregatorFeeLovelace: '500000' },
    } as never);
    const route = { dex: 'MINSWAP', tokenIn: 'lovelace', tokenOut: 'abc', amountIn: '100', expectedOutput: '900', minimumOutput: '880' };
    const res = await mod.nexusSwapApi.buildTx({ route, senderAddress: 'addr1', changeAddress: 'addr1', utxos: [] });
    expect(spy).toHaveBeenCalledWith('/api/aggregator/build-tx', { route, senderAddress: 'addr1', changeAddress: 'addr1', utxos: [] });
    expect(res.unsignedTxCbor).toBe('deadbeef');
  });

  it('submit() posts the verbatim cbor + witness', async () => {
    const mod = await import('./nexus-swap.api');
    const spy = vi.spyOn(mod.swapAxiosInstance, 'post').mockResolvedValue({ data: { txHash: 'tx1', status: 'SUBMITTED' } } as never);
    const res = await mod.nexusSwapApi.submit({ unsignedTxCbor: 'deadbeef', userWitnessHex: 'a100' });
    expect(spy).toHaveBeenCalledWith('/api/aggregator/submit', { unsignedTxCbor: 'deadbeef', userWitnessHex: 'a100' });
    expect(res.txHash).toBe('tx1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/nexus-swap.api.spec.ts`
Expected: FAIL with "Cannot find module './nexus-swap.api'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/api/nexus-swap.api.ts
import axios, { AxiosInstance } from 'axios';

const NEXUS_BASE: string = import.meta.env['VITE_NEXUS_URL'] || '';

export const swapAxiosInstance: AxiosInstance = axios.create({
  baseURL: NEXUS_BASE,
  timeout: 30_000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

export interface SwapRoute {
  dex: string;
  bestPoolId?: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  expectedOutput: string;
  minimumOutput: string;
  priceImpact?: number;
  batcherFeeLovelace?: string;
  aggregatorFeeLovelace?: string;
  estimatedTxFeeLovelace?: string;
}

export interface QuoteRequest {
  tokenIn: string; // "lovelace" for ADA, else policyId+assetName (unit)
  tokenOut: string;
  amountIn: string; // smallest unit, decimal string
  slippageTolerance?: string;
  senderAddress?: string;
  excludeDexes?: string[];
}
export interface QuoteResponse { routes: SwapRoute[]; bestRouteIndex: number; }

export interface NexusUtxoInput { txHash: string; index: number; cborHex: string; }
export interface BuildRequest { route: SwapRoute; senderAddress: string; changeAddress: string; utxos: NexusUtxoInput[]; }
export interface BuildResponse {
  unsignedTxCbor: string; // OPAQUE - never re-serialize
  txBodyHash?: string;
  feeLovelace?: string;
  aggregatorFeeLovelace?: string;
  partnerFeeLovelace?: string;
}

export interface SubmitRequest { unsignedTxCbor: string; userWitnessHex: string; }
export interface SubmitResponse { txHash: string; status: string; trackingUrl?: string; }
export interface StatusResponse { txHash: string; status: string; slot?: number; errorMessage?: string; }

export const nexusSwapApi = {
  async quote(req: QuoteRequest): Promise<QuoteResponse> {
    const { data } = await swapAxiosInstance.post('/api/aggregator/quote', req);
    return data as QuoteResponse;
  },
  async buildTx(req: BuildRequest): Promise<BuildResponse> {
    const { data } = await swapAxiosInstance.post('/api/aggregator/build-tx', req);
    return data as BuildResponse;
  },
  async submit(req: SubmitRequest): Promise<SubmitResponse> {
    const { data } = await swapAxiosInstance.post('/api/aggregator/submit', req);
    return data as SubmitResponse;
  },
  async status(txHash: string): Promise<StatusResponse> {
    const { data } = await swapAxiosInstance.get(`/api/aggregator/status/${txHash}`);
    return data as StatusResponse;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/nexus-swap.api.spec.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/api/nexus-swap.api.ts src/api/nexus-swap.api.spec.ts
git commit -m "feat(copilot): nexus aggregator swap client + types"
```

---

### Task 2: Swap intent parser

**Files:**
- Create: `src/services/agent/swapIntent.ts`
- Test: `src/services/agent/swapIntent.spec.ts`

> Kept separate from `intentRouter.ts` (chart-token) so the swap grammar can grow without touching Plan 1. The parser returns a structured intent; it NEVER resolves the asset or computes the amount (the wallet does both later).

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/agent/swapIntent.spec.ts
import { describe, it, expect } from 'vitest';
import { parseSwapIntent } from './swapIntent';

describe('parseSwapIntent', () => {
  it('parses an explicit-amount swap', () => {
    expect(parseSwapIntent('swap 100 ada for gero')).toEqual({
      type: 'swap', sellSymbol: 'ADA', buySymbol: 'GERO', mode: 'amount', amount: '100',
    });
  });

  it('parses a percentage sell', () => {
    expect(parseSwapIntent('sell 30% of my snek for ada')).toEqual({
      type: 'swap', sellSymbol: 'SNEK', buySymbol: 'ADA', mode: 'percent', percent: 30,
    });
  });

  it('returns null for non-swap text', () => {
    expect(parseSwapIntent('what is my p&l')).toBeNull();
    expect(parseSwapIntent('chart snek')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/agent/swapIntent.spec.ts`
Expected: FAIL with "Cannot find module './swapIntent'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/agent/swapIntent.ts
export interface SwapIntent {
  type: 'swap';
  sellSymbol: string;
  buySymbol: string;
  mode: 'amount' | 'percent';
  amount?: string; // human-entered amount (mode=amount); wallet converts to smallest unit later
  percent?: number; // mode=percent; wallet computes from real balance later
}

const AMOUNT_RE = /\bswap\s+([0-9][0-9_,]*\.?[0-9]*)\s+([a-z0-9]{2,12})\s+(?:for|to|into)\s+([a-z0-9]{2,12})\b/i;
const PERCENT_RE = /\bsell\s+([0-9]{1,3})%\s+of\s+(?:my\s+)?([a-z0-9]{2,12})\s+(?:for|to|into)\s+([a-z0-9]{2,12})\b/i;

/** Deterministic parse of a swap request. No asset resolution, no amount math (the wallet does both). */
export function parseSwapIntent(text: string): SwapIntent | null {
  const t = text || '';
  const a = AMOUNT_RE.exec(t);
  if (a) {
    return { type: 'swap', sellSymbol: a[2].toUpperCase(), buySymbol: a[3].toUpperCase(), mode: 'amount', amount: a[1].replace(/[_,]/g, '') };
  }
  const p = PERCENT_RE.exec(t);
  if (p) {
    const pct = Math.min(100, Math.max(1, parseInt(p[1], 10)));
    return { type: 'swap', sellSymbol: p[2].toUpperCase(), buySymbol: p[3].toUpperCase(), mode: 'percent', percent: pct };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/agent/swapIntent.spec.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/agent/swapIntent.ts src/services/agent/swapIntent.spec.ts
git commit -m "feat(copilot): deterministic swap intent parser"
```

---

### Task 3: The Swap Guardrail (the safety core) - decode + verify

**Files:**
- Create: `src/services/agent/swapGuardrail.ts`
- Test: `src/services/agent/swapGuardrail.spec.ts`

> THE moat and the safety spine. Pure function over an already-decoded tx (the caller decodes via `deserializeCardanoJsSdkTx`, so this stays unit-testable without the SDK). It verifies the user receives at least the quoted minimum of the RESOLVED output asset to an OWN address, change returns to an own address, and there is no unexpected ADA/token outflow to a foreign address beyond the swap deposit. A mismatch returns ok=false with reasons; the UI must block signing on ok=false.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/agent/swapGuardrail.spec.ts
import { describe, it, expect } from 'vitest';
import { verifySwapTx, type DecodedTx, type SwapExpectation } from './swapGuardrail';

const OWN = 'addr_own';
const FOREIGN = 'addr_foreign';

const expectation: SwapExpectation = {
  ownAddresses: [OWN],
  outputAssetId: 'policyGERO.4745524f', // resolved by the WALLET, not the agent
  minOutput: 880n,
  maxSpendLovelace: 105_000000n, // amountIn + fees + batcher cap
};

// A decoded tx where the user receives 900 GERO to their own address (passes)
const goodTx: DecodedTx = {
  outputs: [
    { address: OWN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 900n } },
    { address: FOREIGN, lovelace: 100_000000n, assets: {} }, // the swap deposit to the DEX
  ],
};

describe('verifySwapTx', () => {
  it('passes when the user receives >= minOutput of the resolved asset to an own address', () => {
    const v = verifySwapTx(goodTx, expectation);
    expect(v.ok).toBe(true);
    expect(v.derived.youReceive).toBe(900n);
  });

  it('FAILS when the received output asset is below minOutput', () => {
    const tx: DecodedTx = { outputs: [{ address: OWN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 800n } }] };
    const v = verifySwapTx(tx, expectation);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/below the quoted minimum/i);
  });

  it('FAILS when the output asset is a DIFFERENT token than expected (injected/wrong asset)', () => {
    const tx: DecodedTx = { outputs: [{ address: OWN, lovelace: 2_000000n, assets: { 'policyEVIL.00': 5000n } }] };
    const v = verifySwapTx(tx, expectation);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/did not receive the expected token/i);
  });

  it('FAILS when the expected token is sent to a FOREIGN address (not the user)', () => {
    const tx: DecodedTx = { outputs: [{ address: FOREIGN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 900n } }] };
    const v = verifySwapTx(tx, expectation);
    expect(v.ok).toBe(false);
  });

  it('FAILS when total lovelace leaving to foreign addresses exceeds the max spend', () => {
    const tx: DecodedTx = {
      outputs: [
        { address: OWN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 900n } },
        { address: FOREIGN, lovelace: 200_000000n, assets: {} }, // way over maxSpend
      ],
    };
    const v = verifySwapTx(tx, expectation);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/exceeds the maximum/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/agent/swapGuardrail.spec.ts`
Expected: FAIL with "Cannot find module './swapGuardrail'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/agent/swapGuardrail.ts
export interface DecodedOutput {
  address: string;
  lovelace: bigint;
  assets: Record<string, bigint>; // key: `${policyId}.${assetNameHex}`
}
export interface DecodedTx {
  outputs: DecodedOutput[];
}
export interface SwapExpectation {
  ownAddresses: string[];
  outputAssetId: string; // resolved by the wallet (NOT asserted by the agent)
  minOutput: bigint;
  maxSpendLovelace: bigint; // amountIn + fees + batcher headroom
}
export interface SwapVerdict {
  ok: boolean;
  reasons: string[];
  derived: { youReceive: bigint; lovelaceToForeign: bigint };
}

/**
 * Deterministically verify a built (unsigned) swap tx against the wallet's expectation.
 * The agent supplied none of these numbers - the wallet resolved the asset, the minimum
 * came from the quote, and the outputs are decoded from the actual tx. A hallucinated or
 * injected value cannot pass this gate.
 */
export function verifySwapTx(tx: DecodedTx, exp: SwapExpectation): SwapVerdict {
  const own = new Set(exp.ownAddresses);
  const reasons: string[] = [];

  let youReceive = 0n;
  for (const o of tx.outputs) {
    if (own.has(o.address)) youReceive += o.assets[exp.outputAssetId] ?? 0n;
  }

  let lovelaceToForeign = 0n;
  let foreignHasExpectedToken = false;
  for (const o of tx.outputs) {
    if (own.has(o.address)) continue;
    lovelaceToForeign += o.lovelace;
    if ((o.assets[exp.outputAssetId] ?? 0n) > 0n) foreignHasExpectedToken = true;
  }

  if (youReceive === 0n) {
    reasons.push('You did not receive the expected token from this swap.');
  } else if (youReceive < exp.minOutput) {
    reasons.push('The amount you would receive is below the quoted minimum.');
  }
  if (foreignHasExpectedToken && youReceive < exp.minOutput) {
    reasons.push('The expected token is going to an address that is not yours.');
  }
  if (lovelaceToForeign > exp.maxSpendLovelace) {
    reasons.push('The ADA leaving your wallet exceeds the maximum for this swap.');
  }

  return { ok: reasons.length === 0, reasons, derived: { youReceive, lovelaceToForeign } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/agent/swapGuardrail.spec.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/agent/swapGuardrail.ts src/services/agent/swapGuardrail.spec.ts
git commit -m "feat(copilot): swap Guardrail - deterministic decode-and-verify safety gate"
```

---

### Task 4: Decoded-tx adapter (CBOR -> Guardrail DecodedTx)

**Files:**
- Create: `src/services/agent/decodeSwapTx.ts`
- Test: `src/services/agent/decodeSwapTx.spec.ts`

> Bridges the real `deserializeCardanoJsSdkTx` output (`Cardano.Tx`) to the Guardrail's `DecodedTx`. Kept thin and injectable so it is testable: the function takes an ALREADY-deserialized `Cardano.Tx`-shaped object (the caller deserializes), and maps its `body.outputs` to `DecodedOutput[]` (address bech32, coins -> lovelace, assets map -> `${policyId}.${assetName}` -> bigint). VERIFY the exact `Cardano.TxOut` shape (`address`, `value.coins`, `value.assets` as a Map of AssetId->bigint) against `src/popup/modules/views/SignTx.vue` (which reads outputs) before finalizing.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/agent/decodeSwapTx.spec.ts
import { describe, it, expect } from 'vitest';
import { toDecodedTx } from './decodeSwapTx';

describe('toDecodedTx', () => {
  it('maps Cardano.Tx outputs to DecodedTx (address, lovelace, assets)', () => {
    const assets = new Map<string, bigint>([['policyGERO4745524f', 900n]]);
    const cardanoTx = {
      body: {
        outputs: [
          { address: 'addr_own', value: { coins: 2_000000n, assets } },
          { address: 'addr_foreign', value: { coins: 100_000000n, assets: undefined } },
        ],
      },
    };
    const decoded = toDecodedTx(cardanoTx as never, (id: string) => `${id.slice(0, 56)}.${id.slice(56)}`);
    expect(decoded.outputs[0].address).toBe('addr_own');
    expect(decoded.outputs[0].lovelace).toBe(2_000000n);
    expect(decoded.outputs[0].assets['policyGERO.4745524f']).toBe(900n);
    expect(decoded.outputs[1].lovelace).toBe(100_000000n);
    expect(decoded.outputs[1].assets).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/agent/decodeSwapTx.spec.ts`
Expected: FAIL with "Cannot find module './decodeSwapTx'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/agent/decodeSwapTx.ts
import type { DecodedTx, DecodedOutput } from './swapGuardrail';

// Minimal structural shape we rely on from @cardano-sdk/core Cardano.Tx (verified against SignTx.vue).
interface CardanoTxLike {
  body: {
    outputs: Array<{
      address: string;
      value: { coins: bigint; assets?: Map<string, bigint> };
    }>;
  };
}

/**
 * Map a deserialized Cardano.Tx to the Guardrail DecodedTx. `splitAssetId` turns a
 * concatenated AssetId (policyId+assetName hex) into the `${policyId}.${assetName}` key
 * the Guardrail expects (pass a verified splitter; default splits at 56 chars).
 */
export function toDecodedTx(
  tx: CardanoTxLike,
  splitAssetId: (assetId: string) => string = (id) => `${id.slice(0, 56)}.${id.slice(56)}`,
): DecodedTx {
  const outputs: DecodedOutput[] = tx.body.outputs.map((o) => {
    const assets: Record<string, bigint> = {};
    if (o.value.assets) {
      for (const [assetId, qty] of o.value.assets.entries()) {
        assets[splitAssetId(assetId)] = qty;
      }
    }
    return { address: o.address, lovelace: o.value.coins, assets };
  });
  return { outputs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/agent/decodeSwapTx.spec.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/agent/decodeSwapTx.ts src/services/agent/decodeSwapTx.spec.ts
git commit -m "feat(copilot): Cardano.Tx -> Guardrail DecodedTx adapter"
```

---

### Task 5: Swap orchestration composable (`useAgentSwap`)

**Files:**
- Create: `src/sidepanel/composables/useAgentSwap.ts`
- Test: `src/sidepanel/composables/useAgentSwap.spec.ts`

> Orchestrates the full propose-then-sign flow with INJECTABLE dependencies (so it is unit-testable without the backend or the SDK). Stages: resolve sell/buy symbols -> assetIds (reuse `resolveSymbolToAssetId`; `ADA` -> `lovelace`); compute `amountIn` (explicit -> smallest unit using decimals; percent -> from the real held balance); `quote` -> pick best route -> `buildTx` -> decode -> Guardrail `verifySwapTx`. The result is a `proposal` (status `ready` only if the Guardrail passed). A separate `sign(proposal, auth)` stage runs `scanTx`, then `SIGN_TX`, then `submit`. The composable NEVER auto-signs. Live calls are gated on the Nexus rail; tests inject fakes.

Implement `createAgentSwap(deps)` where `deps` provides `{ resolveSymbol, getBalance, quote, build, decode, verify, scan, sign, submit }`, returning `{ busy, proposal, error, prepare(intent), confirmSign(auth) }`. Write the spec FIRST to lock the contract:

- [ ] **Step 1: Write the failing test**

```typescript
// src/sidepanel/composables/useAgentSwap.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createAgentSwap } from './useAgentSwap';
import type { SwapIntent } from '@/services/agent/swapIntent';

function deps(over: Record<string, unknown> = {}) {
  return {
    resolveSymbol: vi.fn(async (s: string) => (s === 'ADA' ? 'lovelace' : 'policyGERO.4745524f')),
    getDecimals: vi.fn(async () => 6),
    getHeldAmount: vi.fn(async () => 1_000_000_000n),
    quote: vi.fn(async () => ({ routes: [{ dex: 'MINSWAP', tokenIn: 'lovelace', tokenOut: 'policyGERO.4745524f', amountIn: '100000000', expectedOutput: '900', minimumOutput: '880' }], bestRouteIndex: 0 })),
    build: vi.fn(async () => ({ unsignedTxCbor: 'deadbeef' })),
    decodeAndVerify: vi.fn(() => ({ ok: true, reasons: [], derived: { youReceive: 900n, lovelaceToForeign: 100_000000n } })),
    ...over,
  };
}

const intent: SwapIntent = { type: 'swap', sellSymbol: 'ADA', buySymbol: 'GERO', mode: 'amount', amount: '100' };

describe('useAgentSwap.prepare', () => {
  it('resolves symbols, quotes, builds, and verifies into a ready proposal', async () => {
    const d = deps();
    const swap = createAgentSwap(d as never);
    await swap.prepare(intent);
    expect(d.resolveSymbol).toHaveBeenCalledWith('GERO');
    expect(d.quote).toHaveBeenCalled();
    expect(swap.proposal.value?.status).toBe('ready');
    expect(swap.proposal.value?.unsignedTxCbor).toBe('deadbeef');
    expect(swap.proposal.value?.youReceive).toBe(900n);
  });

  it('blocks (status=blocked) when the Guardrail fails - never ready to sign', async () => {
    const d = deps({ decodeAndVerify: vi.fn(() => ({ ok: false, reasons: ['You did not receive the expected token from this swap.'], derived: { youReceive: 0n, lovelaceToForeign: 0n } })) });
    const swap = createAgentSwap(d as never);
    await swap.prepare(intent);
    expect(swap.proposal.value?.status).toBe('blocked');
    expect(swap.proposal.value?.reasons[0]).toMatch(/did not receive/i);
  });

  it('does not auto-sign during prepare', async () => {
    const sign = vi.fn();
    const d = deps({ sign });
    const swap = createAgentSwap(d as never);
    await swap.prepare(intent);
    expect(sign).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sidepanel/composables/useAgentSwap.spec.ts`
Expected: FAIL with "Cannot find module './useAgentSwap'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/sidepanel/composables/useAgentSwap.ts
import { ref, type Ref } from 'vue';
import type { SwapIntent } from '@/services/agent/swapIntent';
import type { SwapVerdict } from '@/services/agent/swapGuardrail';

export interface SwapProposal {
  status: 'ready' | 'blocked';
  sellSymbol: string;
  buySymbol: string;
  amountIn: string;
  unsignedTxCbor: string;
  youReceive: bigint;
  minOutput: bigint;
  reasons: string[];
}

export interface AgentSwapDeps {
  resolveSymbol: (symbol: string) => Promise<string>; // 'ADA' -> 'lovelace'
  getDecimals: (assetId: string) => Promise<number>;
  getHeldAmount: (assetId: string) => Promise<bigint>;
  quote: (req: { tokenIn: string; tokenOut: string; amountIn: string }) => Promise<{ routes: Array<{ amountIn: string; minimumOutput: string; expectedOutput: string }>; bestRouteIndex: number }>;
  build: (route: unknown) => Promise<{ unsignedTxCbor: string }>;
  decodeAndVerify: (unsignedTxCbor: string, outputAssetId: string, minOutput: bigint, maxSpendLovelace: bigint, amountIn: bigint) => SwapVerdict;
}

function toSmallest(amount: string, decimals: number): bigint {
  const [whole, frac = ''] = amount.split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

export function createAgentSwap(deps: AgentSwapDeps) {
  const busy: Ref<boolean> = ref(false);
  const error: Ref<string> = ref('');
  const proposal: Ref<SwapProposal | null> = ref(null);

  async function prepare(intent: SwapIntent): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    proposal.value = null;
    try {
      const tokenIn = await deps.resolveSymbol(intent.sellSymbol);
      const tokenOut = await deps.resolveSymbol(intent.buySymbol);
      let amountIn: bigint;
      if (intent.mode === 'percent') {
        const held = await deps.getHeldAmount(tokenIn);
        amountIn = (held * BigInt(intent.percent ?? 0)) / 100n;
      } else {
        const decimals = await deps.getDecimals(tokenIn);
        amountIn = toSmallest(intent.amount ?? '0', decimals);
      }
      const q = await deps.quote({ tokenIn, tokenOut, amountIn: amountIn.toString() });
      const route = q.routes[q.bestRouteIndex];
      const minOutput = BigInt(route.minimumOutput);
      const built = await deps.build(route);
      const maxSpend = amountIn + 5_000000n; // headroom for fee + batcher (lovelace side only)
      const verdict = deps.decodeAndVerify(built.unsignedTxCbor, tokenOut, minOutput, maxSpend, amountIn);
      proposal.value = {
        status: verdict.ok ? 'ready' : 'blocked',
        sellSymbol: intent.sellSymbol,
        buySymbol: intent.buySymbol,
        amountIn: amountIn.toString(),
        unsignedTxCbor: built.unsignedTxCbor,
        youReceive: verdict.derived.youReceive,
        minOutput,
        reasons: verdict.reasons,
      };
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not prepare the swap.';
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, proposal, prepare };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sidepanel/composables/useAgentSwap.spec.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/composables/useAgentSwap.ts src/sidepanel/composables/useAgentSwap.spec.ts
git commit -m "feat(copilot): swap orchestration composable (prepare = quote->build->guardrail)"
```

---

### Task 6: Inline SwapCard + dock wiring + sign path + i18n + build

**Files:**
- Create: `src/sidepanel/components/agent/SwapCard.vue`
- Modify: `src/sidepanel/composables/useAgentDock.ts` (route a swap intent)
- Modify: `src/sidepanel/components/AgentDock.vue` (render SwapCard)
- Modify: `src/plugins/i18n/us.ts`, `src/plugins/i18n/de.ts`

> The card renders the proposal (you-pay / you-receive / route / fee), the risk line, and a **Sign** button enabled ONLY when `proposal.status === 'ready'` (blocked proposals show the Guardrail reasons and cannot be signed). The Sign handler is the propose-then-sign path: run `cardanoShieldApi.scanTx`, then `MessageTypes.SIGN_TX` (the wallet decrypts via password/PRF and returns the detached `{ witnesses }`), then `nexusSwapApi.submit({ unsignedTxCbor, userWitnessHex })` (verbatim cbor; never retried). Wire the actual `useAgentSwap` deps to the real clients here (resolveSymbolToAssetId, market-api decimals/holdings, nexusSwapApi, deserializeCardanoJsSdkTx + toDecodedTx + verifySwapTx). In `useAgentDock`, when `parseSwapIntent(text)` matches, attach a `swap` intent to the assistant message so AgentDock renders `<SwapCard>`. Because AgentDock is the shared dock, this appears in BOTH the sidepanel and the dashboard.

- [ ] **Step 1: Implement SwapCard.vue** (renders proposal; Sign disabled unless ready; shows Guardrail reasons when blocked; calls the sign path). Use `$t` for all labels; include the "not financial advice" framing already in the dock. (Full template/script written during execution against the verified `useAgentSwap` + sign message shapes.)

- [ ] **Step 2: Wire `useAgentDock`** so a swap message carries a `swap` intent (mirror how chart-token intents are attached in Plan 1). Add a `DockMessageIntent` variant `{ type: 'swap'; intent: SwapIntent }`.

- [ ] **Step 3: Render `<SwapCard>` in AgentDock** when `m.intent?.type === 'swap'` (sibling to the existing ChartCard branch).

- [ ] **Step 4: i18n** - add `copilot.swap.*` keys (youPay, youReceive, route, fee, sign, signing, blocked, minReceived, riskHigh, submitted, failed) to BOTH us.ts and de.ts.

- [ ] **Step 5: Verify** - `npm run typecheck` (no new errors for the new files), `npm run lint` (clean for touched files), `npm run build` (MUST succeed; retry once on the known flaky html-proxy error). Manual run is gated on the Nexus aggregator rail; document that the dock renders the swap card and the Guardrail blocks a mismatch, but live quote/build/submit await the backend.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/components/agent/SwapCard.vue src/sidepanel/composables/useAgentDock.ts src/sidepanel/components/AgentDock.vue src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(copilot): inline SwapCard + dock wiring + propose-then-sign path + i18n"
```

---

## Self-Review

- **Safety spine covered:** the agent emits a structured intent only (Task 2); the wallet re-resolves the asset + computes the amount (Task 5); the Guardrail decodes the built tx and blocks any mismatch (Tasks 3-4); the card is signable only on a passing verdict and never auto-signs (Tasks 5-6); the unsigned CBOR is opaque end-to-end and submit is never retried (Tasks 1, 6).
- **Both surfaces:** the SwapCard renders in the shared AgentDock, so it appears in the sidepanel and the dashboard with no extra work.
- **Backend prerequisite is explicit:** live quote/build/submit need the Nexus `/api/aggregator/*` rail; everything is unit-tested against the contract, and the Guardrail (the safety core) needs no backend.
- **Type flow:** `SwapIntent` (Task 2) -> `useAgentSwap.prepare` (Task 5) -> `SwapProposal`; `DecodedTx`/`SwapExpectation`/`SwapVerdict` (Task 3) consumed by Task 4's adapter and Task 5's `decodeAndVerify`; `SwapRoute`/`BuildResponse` (Task 1) used by Task 5/6.
- **Verification flags for execution:** confirm the `Cardano.TxOut` shape (`value.coins`, `value.assets` Map) against `SignTx.vue` (Task 4); confirm the `MessageTypes.SIGN_TX` request/response shape and how to call it from the dock context (Task 6); confirm `market-api` provides token decimals + held amounts, else source decimals from the resolved token metadata (Task 5/6).
- **Deferrals:** limit/DCA, reverse quotes, perps (Plan 4), autonomous execution / Agent Allowance (Plan 5).
