# Gero Copilot - Smart Agent UX Design Spec

**Status:** Design (brainstormed, pending user review)
**Date:** 2026-06-26
**Branch:** `feat/copilot-agent` (siloed worktree off `development`)
**Parent strategy:** `docs/proposals/2026-06-25-gero-smart-wallet-ai-pmf.md` (PMF + monetization; lives on `feat/2.7-release-prep`)

## 1. Summary

Turn Gero into a non-custodial Smart Wallet by embedding a context-aware AI agent ("Gero Copilot") across the entire wallet. The LLM itself runs on Fluxpoint's side; **this spec owns the wallet-side UX and architecture**: how the agent is invoked, how it renders rich answers and live action widgets inline, how it completes real on-chain actions non-custodially, how it proactively surfaces interesting activity, and how a user can delegate a bounded spending allowance for autonomous agent-to-agent payments.

The agent has **three modes over one spine**:

- **Mode 1 - Pull (conversational):** the user talks to the agent; it answers with inline graphs and **live action widgets** (swap, perps, send, card, charts) completed inside the chat.
- **Mode 2 - Push (proactive "degen friend"):** the wallet pipes up on its own about interesting on-chain activity (your holdings, the ecosystem, smart-money), plus the agent's own spend receipts.
- **Mode 3 - Delegate (Agent Allowance):** a bounded, revocable spend leash so the agent can pay autonomously (services / other agents / x402 / subscriptions) and run rules the user preset (DCA, gas top-ups, conditional rebuys the user defined).

## 2. The spine (invariants true in all three modes)

1. **Non-custodial.** The agent either *prepares* an action the user signs, or *spends within a bounded leash the user can cut at any time*. The seed and main funds are never exposed to the agent. Anything that *raises* the user's risk (signing a tx, topping up or raising an allowance) requires the user's explicit action. The worst-case loss is always capped by design.
2. **No financial advice.** The agent is an **observer and an executor of the user's intent**, never a recommender. It describes what happened, prepares what the user asked for, and runs rules the user set. It never says "you should buy/sell/hold," never predicts price, never judges suitability. (Framing/compliance UX is ours; the model-side phrasing controls are Fluxpoint's.)

## 3. Non-goals (explicitly out of scope)

- Agent **discretionary trading** (the agent deciding, on its own judgment, to swap/rebalance the user's assets). Trades are either Mode-1 (agent prepares, user signs) or Mode-3 preset rules (user-defined). Chosen ceiling: **payments + user-preset rules**, never agent discretion.
- **Auto-signing** of any value-moving transaction outside the bounded allowance.
- Re-implementing wallet features. The agent **summons existing native components**; it does not build parallel UI.
- LLM hosting, model choice, token-cost optimization, and narration-level content filtering (Fluxpoint-side).

## 4. Agent-everywhere principle

The agent is a **global, persistent layer available on every route**, not a destination you navigate to.

- **Global affordance:** an always-reachable "ask Gero" dock/overlay that travels with the user across every screen and platform (extension popup, sidepanel, options, iOS, Android). One persistent conversation thread, not per-screen silos.
- **Per-screen context injection:** every screen contributes a typed `ScreenContext` (route, focused asset/position/order, visible data) to the agent so it can act on *what the user is looking at*. On the perps screen it can act on the open position; on a token page it can chart/screen *that* token; on the card screen it can pull cashback/controls.
- **Context entry points:** screens expose inline agent actions ("explain this," "chart it," "is this safe," "adjust with Gero," "freeze card") that deep-link into the agent pre-loaded with that context.

## 5. Mode 1 - Generative UI + inline non-custodial actions (the centerpiece)

The defining interaction: the agent does not reply with text and a link that ejects the user to another screen. It **renders a real, live wallet component inline and completes the action in place.**

**Pattern:** the agent emits a typed **intent** (its tool-call result), the wallet maps the intent to one of its **existing native widgets** via an **Intent -> Widget registry**, and renders it as a card in the chat.

**Reference flow - "swap 100 ada for gero":**
1. User asks (typed or voice). Agent emits `intent: swap{ tokenIn: ADA, tokenOut: GERO, amount: 100, mode: market }`.
2. Chat renders the **real swap widget inline**, pre-filled, showing you-pay / you-receive / route / price impact / aggregator fee + inline risk read (`/token-analysis` flat-billed + Xerberus + in-house liquidity/holders).
3. User can tweak in place (amount, slippage) - it is the live widget, not a static summary.
4. User taps **Sign**. The existing propose-then-sign Guardrail runs: the wallet (not the LLM) re-resolves ticker -> policyId and REJECTS on mismatch, computes amounts from real balances, rebuilds and diffs the CBOR, `cardano-shield scanTx` runs, biometric/password, submit. Keys never leave the device.
5. Result + updated balance render inline.

**Read intents vs action intents:**

| Intent | Inline widget | Type |
|---|---|---|
| swap X for Y | Swap widget | Action (sign) |
| open/close/adjust perp | Perps order ticket | Action (sign) |
| send N to <addr/handle> | Send widget (handle-resolved) | Action (sign) |
| stake / delegate | Delegation card | Action (sign) |
| freeze/unfreeze card, limits | Card control | Action (sign/confirm) |
| chart / price / TA for token | OHLCV chart (market-api) | Read |
| portfolio / P&L this month | P&L breakdown card | Read |
| cashback balance / Gero Card status | Status card | Read |

**Invariant:** the agent fills the form; the user signs the form. Value-moving cards always display amounts the **wallet** computed, never figures the agent asserted. A hallucinated or injected number can never reach the signer.

## 6. The no-advice house style (UI enforcement)

The friend/agent voice has personality but is an observer/executor. The wallet-side enforcement we own:

- **Framing:** present agent output as information and prepared actions, never as recommendations. Every agent surface carries a quiet "not financial advice. DYOR." line and ships under the required AI-use disclosure.
- **Action vs advice in copy:** the agent will *prepare* "swap 100 ADA for GERO" because the user asked; it will not *suggest* "you should swap into GERO."
- **Allowed:** verifiable past facts (amounts, %s, timeframes, labeled wallets), factual references to the user's holdings ("a token in your bags"), reactions to an event's notability ("ok this is wild").
- **Forbidden:** action recommendations (buy/sell/ape/exit/get in), price predictions/targets (moon/dump/zero/x), personalized suitability ("good for your portfolio"), manufactured urgency.

Model-level phrasing control is Fluxpoint's; the wallet provides the disclosure UI, the framing, and the deterministic action Guardrail (which constrains what an action can *do* regardless of what the model *says*).

## 7. Mode 2 - Proactive "degen friend"

Deterministic detection + Fluxpoint narration, fanned out.

- **Detection (deterministic, on existing rails):** gero-sync + Ably `onTip` + market-data API detect threshold events across thousands of tokens (liquidity delta, volume z-score, whale/labeled-wallet moves, new pools, holdings movers, risk-score changes). No LLM in detection.
- **Relevance/ranking:** personalize via holdings + `useWatchlist`; rank by signal so the friend is high-signal, not spammy.
- **Narration (once per event, then fan-out):** a notable event is narrated once in the friend voice and delivered to all relevant users. Cost scales with distinct notable events, not tokens x users.
- **Delivery layers (all of them, user-tunable):**
  - **Friend feed:** a scrollable in-app stream of the friend's takes (low pressure).
  - **Selective push:** only genuinely spicy/high-signal events push (mobile-native always-on channel).
  - **Daily digest:** optional 1-2 "here's what went down" recaps.
  - **Tuning dial:** vibe (chill / normal / full-degen) + per-category mutes (bags / whales / launches / governance).
- **Spend receipts:** Mode-3 agent payments surface here too ("paid 0.4 ADA to DataAgentX for a price feed"), keeping autonomy transparent.

## 8. Mode 3 - The Agent Allowance (delegated autonomous payments)

Moves the agent from "sign every tx" to "bounded, revocable authority," enabling agent-to-agent / x402 payments where per-tx signing is impossible.

**Ceiling (decided):** the agent may **(a) pay autonomously** (services, other agents, x402, subscriptions) and **(b) execute user-preset rules** (DCA, gas top-ups, conditional rebuys the user defined). The agent never decides a trade on its own judgment.

**The leash:**
- **Capped, user-funded balance** separate from the main wallet (a prepaid "allowance jar"). The agent can spend only from it, only within limits. Main/seed funds are never exposed; worst case is the capped allowance.
- **Limits:** per-payment max, daily max, total budget.
- **Allowlist (default-deny):** only categories/payees the user enabled. The agent cannot invent a payee.
- **Expiry / auto-revoke** so a forgotten leash never lingers.
- **Live receipts** in the friend feed; running balance and limits shown as gauges.
- **Instant kill-switch:** one tap pauses or drains the allowance back to the main wallet.
- **Signed escalations:** top-ups and limit increases require the user's signature. De-escalations are instant and unilateral.

**Implementation (Cardano has no native account abstraction), sequenced:**
1. **Bounded hot sub-account (ship first):** a separate account with its own scoped key for low-value A2A micropayments; main funds cold.
2. **On-chain script-escrow (larger/trustless):** a validator enforces caps + allowlist + expiry in the datum (strategy L3); graduate larger budgets here.

**Strategic value:** positions Gero on the agent-to-agent payment rail (x402; Cardano Foundation + SingularityNET) and is a revenue surface (spread/fee on agent-routed payments; leans on Fluxpoint metered mode).

## 9. Architecture & components (wallet-side)

- **AgentProvider interface** - wraps Fluxpoint (`chat`, streaming `tool_call`/`tool_result` frames, the metering rail). Swappable (second/self-hosted model, on-device Apple Foundation Models on capable iOS). The wallet owns orchestration because `/chat` is stateless and `reply_json` is null.
- **Global AgentLayer (UI)** - the persistent dock/overlay + conversation thread, mounted once and available on every route; per-platform shells (extension sidepanel with SSE via `fetch`+`ReadableStream`; iOS/Android native). Streaming + optimistic UI.
- **ScreenContext provider** - each screen contributes typed context for per-screen awareness.
- **IntentRouter + Widget registry** - validates every tool-call argument (amount, policyId, recipient) as if hostile, then maps intents to existing native widgets.
- **Guardrail (existing, reused)** - propose-then-sign: ticker->policyId re-resolution, balance math, CBOR rebuild+diff, `cardano-shield scanTx`, `background.ts METHOD.signTx` -> `SignTx.vue`. Centralize in Nexus as a shared intent API so Swift + extension cannot fork the invariant.
- **ProactiveEngine** - deterministic detectors over gero-sync/Ably/market-data + relevance ranking + narrate-once/fan-out + delivery (feed/push/digest) + dial.
- **AllowanceService + allowance account** - funding, limit enforcement, allowlist, expiry, receipts, kill-switch; phase-2 script-escrow.
- **Reused data/services** - market-api (charts/P&L/pools/quotes), Nexus aggregator (`aggregatorFeeLovelace`), Xerberus, `/token-analysis`, `useWatchlist`.

## 10. Surface map & entry points

- **Global:** "ask Gero" dock on every route; one thread.
- **Per screen:** Portfolio ("explain my P&L," "what moved"), Token/Market ("chart it," "is this safe," "swap"), Perps ("adjust/close my position"), Swap ("swap X for Y"), Cashback ("how much," "how it works"), Gero Card ("freeze," "limits," "cashback"), Send/Receive ("send N to handle").
- **Proactive:** friend feed entry in nav + push + optional digest.
- **Allowance:** an "Agent Allowance" settings/management surface with gauges, receipts, controls.

## 11. MVP sequencing (phased, gated)

1. **Phase 0 - Read + Proactive (no custody risk):** global AgentLayer + ScreenContext; Mode-1 **read** intents (charts, P&L, cashback/card status, portfolio Q&A); Mode-2 friend feed + selective push. Gate: W4 retention on the read cohort.
2. **Phase 1 - Flagship action:** inline **swap** through Nexus aggregator + Guardrail (rail already live on iOS); then **send**. Gate: Guardrail rebuild+diff passing 100%; zero-drain record.
3. **Phase 2 - More actions + digest + dial:** **perps** (gated on 2.7 Strike auth fixes), staking, card controls; daily digest; tuning dial.
4. **Phase 3 - Agent Allowance:** bounded hot allowance for A2A/x402 payments + live receipts + kill-switch; then **preset rules** (DCA, gas top-ups); then on-chain script-escrow for larger budgets.

## 12. Risks & mitigations

- **Prompt injection via on-chain text** (token names/NFT descriptions in untrusted context): architectural defense - LLM proposes only; user signs wallet-decoded ground truth; deterministic Guardrail + `scanTx` before every sheet; router validates every tool-call arg.
- **Autonomous-spend blast radius (Mode 3):** capped, allowlisted, expiring, instantly revocable allowance; main funds never exposed; signed escalations only.
- **App Store / Play:** swap take-rate + on-ramp untaxed (consumed-outside-app); subscription via IAP (15% SBP); GERO/ADA discount must be off-platform (not an in-app unlock); AI-data-sharing consent screen required. (See strategy section 14.)
- **Latency (~5.8s/non-streamed turn):** streaming UX + optimistic UI + on-device narrator fallback; never block the wallet on the agent.
- **Cross-platform Guardrail duplication:** centralize router + Guardrail in Nexus; clients only present + diff + sign.
- **Single-vendor (Fluxpoint):** AgentProvider abstraction + metering-rail abstraction; all execution on Nexus so an outage degrades to "no chat," never "cannot trade."

## 13. Testing approach

- **Guardrail unit tests:** ticker/policyId mismatch -> reject; CBOR diff on any amount/recipient delta -> reject; balance math from real state.
- **Intent router fuzzing:** hostile/malformed tool-call args (wrong policyId, oversized amount, unknown payee) -> rejected.
- **Allowance enforcement tests:** over-cap payment, non-allowlisted payee, expired leash, daily-cap exhaustion -> blocked; kill-switch drains correctly.
- **No-advice copy tests:** snapshot/assert disclosure presence and absence of forbidden patterns on agent surfaces.
- **Proactive engine:** detector threshold tests; narrate-once/fan-out dedup; dial/mutes honored.
- **E2E:** "swap 100 ADA for GERO" inline completes and signs; per-screen context routes correctly; streaming + fallback paths.

## 14. Decisions (resolved 2026-06-26)

1. **MVP action set:** read intents (charts, P&L, cashback/card status, portfolio Q&A) + the proactive feed ship first (Phase 0, zero custody risk); **swap** is the first action (Phase 1); **perps** follow and are gated on the 2.7 Strike auth fixes.
2. **Agent Allowance:** start as a **bounded hot sub-account** with conservative defaults (user-set total budget; a per-payment cap and a daily cap; default 30-day expiry; default-deny allowlist). Graduate a budget to on-chain script-escrow when it exceeds a configurable threshold. Top-ups and limit increases are signed; de-escalations are instant.
3. **One agent, one history, two surfaces:** the proactive "friend" and the chat share a single conversation/event history, surfaced as (a) a scrollable feed view and (b) the global chat dock. Not two separate threads.
4. **Centralize router + Guardrail in Nexus** (shared intent API) so Swift + extension cannot fork the invariant. Clients only present, diff, and sign.
5. **Branding:** the agent is **Gero Copilot**; the proactive persona is a **voice mode** of the same agent (the "friend" tone), not a separate product/brand.
