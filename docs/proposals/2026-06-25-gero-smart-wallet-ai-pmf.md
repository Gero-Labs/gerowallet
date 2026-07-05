# Gero Smart Wallet — Definitive Product Strategy

**Status:** Founder/exec decision document · **Author:** Head of Product · **Date:** June 2026
**Verdict:** One bet. Hardened against the red-team. Ship the painkiller free, monetize the reflection + action layer, scale on multi-chain.
**Platform note (added §14):** Gero also ships a **native iOS app**, and its Nexus swap rail (`NexusSwapService`) is **already live in Swift** while the extension's port is "not started" — so **iOS leads monetization and acquisition**, the **App Store de-risks the ~9k-install problem** (the strategy's biggest weakness), and Apple's real take is **~8–12% blended, not 30%** (swaps/on-ramp untaxed; only the subscription pays IAP's 15%). Ship **Android alongside** (Play is the friendlier twin). See §14.

> **A note on the numbers in this doc.** Every figure has been re-baselined onto *verified* inputs after an internal adversarial review (the "red-team"). Where an earlier draft assumed 40–60k installs and an 8–12% paid conversion, this document uses the **verified ~9,000 Chrome install base** and a **4–6% base-case conversion** (8% bull). The original projections were ~10x too high; this document does not repeat that error. External market claims are cited; modeled figures are labeled as estimates with stated assumptions.

---

## 1. Executive Summary

**The bet: ship *Gero Copilot* — the only Cardano-native, non-custodial AI trade copilot where the agent proposes and you sign locally.** The wedge is **not** "chat with your wallet" (a commodity Fuku/Yoroi are already shipping to 33x our base). The wedge is the **deterministic Guardrail**: *the AI literally cannot set the number you sign.* That single architectural fact is simultaneously our demand differentiator, our copy-defense, and our answer to "AI drained my wallet."

We lead with a **free, frequent painkiller** — a pre-sign "what am I actually signing / is this safe?" verdict at the moment of signing, served at ~$0 marginal cost (deterministic, no LLM call). That builds the daily habit and the trust. We monetize the **reflection layer** (AI portfolio + FIFO P&L + tax export) and the **action layer** (AI-routed swaps via Nexus) behind a **Plus ($9.99) / Pro ($29.99)** subscription.

**Revenue thesis:** Subscription is the M1–M12 engine because Cardano spot-swap fees are hard-capped (~$16M/wk DEX volume, ~$91M TVL → low-five-figures/yr realistic capture). The swap take-rate and the metered agent become the **scale lever only when the same agent layer ports to the already-built Bitcoin stack, then Solana, then EVM** — where fee bases are 10–100x larger. **Cardano-first earns trust and proves the agent; multi-chain earns the revenue.**

---

## 2. The Opportunity & Why Now

**The convergence.** Two waves are colliding in mid-2026: agentic AI and self-custody. Every Tier-1 wallet shipped an agent in a 7-month window — **MetaMask Agent Wallet (Jun 8 2026** — mandatory tx-simulation + Blockaid + MEV protection across 10 chains), **Coinbase AgentKit/Coinbase-for-Agents, OKX agentic wallet (Mar 2026), Trust**. The **Cardano Foundation + SingularityNET shipped x402** giving autonomous agents their own wallets. The thesis "wallets become conversational" is now consensus, not contrarian.

**But the field split the wrong way for us to exploit.** Nearly every shipped agent is **EVM/Solana-first** and most **handed the agent a TEE/MPC key** (agent-custody autonomy). That choice produced the 2026 horror reel: **Bankr/Grok ~$150k drained via a Morse-code prompt injection in an X reply; Step Finance ~$40M via excessive agency; ~$45M+ aggregate across AI-agent incidents (KuCoin).** The market now associates "AI wallet" with "AI drains wallet." The **DeFAI token cohort cratered 70–97%**, discrediting token-first plays and validating real-fee models.

**Why now for Gero specifically.** No shipped non-custodial agentic *trade assistant* **is a Cardano wallet**. Fuku AI is an onboarding **embed** (swap/stake/LP only, DexHunter-routed) moving into Yoroi/Ctrl; TruBot was **rejected in Catalyst Fund 14**. The Cardano-AI window is genuinely open — **but closing**, measured in months, as Yoroi evolves into "SecondFi" and Fuku moves toward Ctrl GA + a third-party SDK. **Speed is the only durable demand defense.**

**Cardano context (the honest version).** ~4.4M holders / ~4.83M wallets, ~1.3M staking addresses, 63–67% of ADA staked — extraordinary *passive* engagement but thin *active* money. Strict daily-active addresses are ~9–16k. DefiLlama (Jun 2026): **TVL ~$91M (down from ~$132M in April), rank ~27**, Minswap ~25% of all chain TVL; top-3 DEX weekly volume ~$16.36M. **This is the timing tailwind and the revenue ceiling in one breath: the AI moment is now, but Cardano fees alone cannot fund a company.**

---

## 3. ICP & Jobs-To-Be-Done

**Beachhead: the active Cardano DeFi trader/yield-seeker** — holds 2+ tokens, swaps at least monthly, touches 2+ protocols (Minswap / Strike / Indigo). This is the only segment where **pain × ability-to-pay × reachability all peak simultaneously**, and the revenue mechanism (per-trade fee + research subscription) is proven and needs no behavior change.

**The red-team correction on reachability (do not skip).** The "20k–50k VESPR/Eternl power users" are **not our audience today** — they're on other wallets, and **there is no automatic distribution wedge** to pull them into a ~9k-install wallet. So the model is gated on **install growth as a milestone**, not assumed. We earn this cohort via the free viral painkiller, CT/KOL seeding, and protocol co-marketing — *before* projecting payer counts.

**The painful, frequent job — corrected.** The red-team's sharpest catch: we must not conflate a *frequent free job* (swapping) with an *infrequent premium job* (monthly P&L reflection). The job that is **both frequent and a painkiller** is at the **moment of signing**:

> **"Tell me, in plain English and computed from the actual transaction, exactly what I'm about to approve — and stop me before I sign something that drains me."**

Signing is frequent; the cost of a bad sign is total loss. That is the wedge job. The **reflection job** ("how's my portfolio / what's my realized P&L / give me a tax export") is real and monetizable but **monthly** — it's the upsell, not the hook.

**Segment ranking (size × pain × WTP × reachability-via-Gero):**

| # | Segment | Role in strategy | WTP |
|---|---|---|---|
| 1 | **Active DeFi traders / degens** | **Beachhead.** Pay 0.9–1% to Telegram bots (Trojan/BullX) that return zero intelligence; also pay $39–120/mo alpha + $60+/mo TradingView | Highest |
| 2 | DeFi power users (Indigo/Strike/lending) | Convert to Pro for cross-protocol portfolio + risk | High |
| 3 | Long-term ADA stakers (~1.3M) | **Free funnel.** Daily conversational engagement, near-zero marginal AI cost; the activation prize | Low direct |
| 4 | Newcomers / non-technical | **Trust/word-of-mouth.** Free pre-sign safety verdict | Lowest direct |
| 5 | DAO/governance/Catalyst | Premium add-on | Moderate |
| 6 | SPOs (~3,000 pools) | High-priced niche tier later; near-zero competition | High, niche |

**WTP is already priced by the market** (the bundle thesis): per-trade execution 0.5–1% (Trojan/BullX/eToro), charts ~$60–70/mo (TradingView), tax $49–299/yr (Koinly), alpha $39–120/mo. A **Gero Pro at $29.99/mo** undercuts buying these separately (>$150/mo) over **data Gero already produces in-house.**

---

## 4. Competitive Landscape & Positioning

**The buyer's real alternatives (April Dunford — start from the status quo):**

| Alternative | What it is | Where it fails the Cardano DeFi trader |
|---|---|---|
| **Status quo** | Manual hopping across Minswap/Sundae/etc., charts, spreadsheet P&L | No best-execution, no in-context risk, no auto-P&L |
| **Generic chatbot (ChatGPT)** | Can talk crypto | **Can't see your wallet, can't price your bags, can't execute** |
| **EVM/Solana "agentic wallets"** (OKX, Coinbase AgentKit, Cobo, MetaMask Agent Wallet) | Machine-first, often agent-custody, multi-chain | **No Cardano DeFi**; lean toward autonomy (scarier category) |
| **Incumbent Cardano wallets** (VESPR, Eternl, Lace, Yoroi) | Mature, large distribution | **No AI** (Fuku is an embed, not a native non-custodial trade copilot) |
| **Telegram trade bots** (Trojan/BullX/Maestro) | Fast execution | ~1%/swap, **zero portfolio intelligence, zero rug screening, not Cardano-native** |

**The white space:** *in-wallet, Cardano-native, strictly human-in-the-loop, AI trade copilot grounded in proprietary 12-DEX data, where the agent proposes and you sign locally.* No competitor combines all five.

**Three unique attributes no rival has under one roof on Cardano** (this is the moat — lead with it, *not* the chat):
1. **Proprietary in-house data** — Gero's own market-data API (`market-api.ts`): 12-DEX prices, OHLCV, **FIFO realized+unrealized P&L**, holdings, NFT floors, liquidity pools, **real + simulated order books**, + Xerberus risk. *Rivals rent Zerion/Alchemy.*
2. **The deterministic Guardrail** — the wallet (not the LLM) re-resolves ticker→policyID, computes the real held balance, rebuilds and diffs the CBOR. *The AI cannot set the number you sign.*
3. **Genuinely non-custodial execution + a 9-protocol action layer** (Fluxpoint cardano-defi-skills, unsigned-CBOR→local-sign; Flux Point owns Saturn Swap).

**Positioning statement (Dunford):**
> *For active Cardano DeFi traders who are tired of spreadsheet-hopping and getting rugged, **Gero Copilot** is the AI trade copilot for self-custody DeFi that understands your real portfolio across 12 DEXes and re-derives every trade deterministically — unlike EVM agentic wallets that hold your keys, **the AI proposes and you sign; your keys never leave your device.***

**Category to win:** *"The AI trade copilot for self-custody DeFi."* We claim **copilot/assistant (human-in-the-loop)** and explicitly **reject "autonomous agent,"** which reframes OKX/Coinbase as a different, scarier category and makes non-custody the headline virtue.

**Product name & taglines:**
- **Name:** **Gero Copilot**
- **Primary tagline:** *"Your DeFi copilot. You hold the keys."*
- **Trust headline (the moat, weaponized):** *"The AI that actually sees your portfolio — and signs nothing without you."*
- **Anti-injection headline:** *"We show you the exact amounts and recipients computed from the transaction itself — never asserted by the AI."*

### 4.1 MetaMask Agent Wallet — the incumbent benchmark (shipped 2026-06-08)

MetaMask/Consensys shipped **Agent Wallet** in early access on 2026-06-08 (CLI-first via an `mm` CLI + installable skill; broader release "later this summer"). It is the clearest signal that our thesis is right, and it sets the security-UX bar we now have to meet. Sourced facts:

- **Same thesis, EVM-side:** first self-custodial agent wallet reaching all of DeFi (swaps, perps, prediction markets, LP) across EVM chains **plus Hyperliquid**, explicitly pitched as "killing the autonomy-vs-safety trade-off."
- **Mandatory, non-opt-out security pipeline** per tx: (1) simulation, (2) Blockaid threat scanning ("Transaction Shield"; only on Blockaid-supported chains: ETH, Linea, Arbitrum, Avalanche, Optimism, Base, Polygon, BSC, Sei), (3) MEV protection (Smart Transactions).
- **Two modes** = the user-limit UX: **Guard Mode** (default: protocol allowlist + daily spend caps + 2FA on out-of-policy) and **Beast Mode** (any protocol; 2FA only on flagged-malicious). Out-of-policy txs route to the user for approval via **email / MetaMask Mobile push**.
- **Trust play:** "Transaction Protection" **loss guarantee up to $10,000/month** on safe txs (subject to T&Cs).
- **Dev-first GTM:** integrates with agent frameworks (Claude Code, OpenAI Codex, Cursor, others).
- **Honest caveats:** the key/custody mechanism is **not disclosed** in their docs ("self-custodial," "scoped authority," mechanism unspecified); sources conflict on chain count (9 Blockaid-scanned vs "25+ EVM").

**How Gero maps to it (match / differ):**

| Dimension | MetaMask Agent Wallet | Gero Copilot |
|---|---|---|
| Security enforcement | Mandatory sim + Blockaid + MEV (agent can't opt out) | Deterministic Guardrail: ticker→policyID re-resolve, real-balance math, CBOR rebuild+diff, `cardano-shield scanTx` (in-house, not a 3rd-party rent) |
| Bounded autonomy | Guard/Beast modes, allowlist, daily caps, 2FA | Agent Allowance: bounded hot sub-account, per-payment/daily/total caps, default-deny allowlist, expiry, kill-switch |
| Chains | EVM + Hyperliquid | **Cardano/UTxO-native** (their blind spot), then BTC/Midnight/multi-chain |
| Surface / GTM | CLI + agent-framework infra for **builders** | **Consumer** wallet with embedded copilot + proactive feed |
| Posture | Autonomous execution | **Human-in-the-loop copilot; explicitly no financial advice** (enforced in code: `noAdvice.spec.ts`) |
| Data | Rents (implied) | Proprietary 12-DEX market-api + FIFO P&L + Xerberus |

**Takeaways for our roadmap:**
1. **Cardano-native is the moat they cannot contest** — an EVM-only agent wallet has zero Cardano DeFi reach. Lead with it.
2. **Adopt the two-mode UX naming** (a "Guard/Beast"-style default-safe vs. relaxed split) for the Agent Allowance surface; it is cleaner than a raw caps form.
3. **Adopt the out-of-policy → push/email approval** escalation pattern for signed escalations.
4. **Have a position on the loss-guarantee** trust play; we will not underwrite $10k, so counter with "your keys never leave your device + deterministic Guardrail + non-custody" as the trust story (which their custody-undisclosed model cannot claim as cleanly).
5. **Keep the human-in-the-loop / no-advice framing as differentiation** — they lean autonomy; we make non-custody + observer-not-advisor the headline virtue (already our positioning above).

---

## 5. The Product

### 5.1 Feature architecture — the propose-then-sign spine

Every write feature obeys one invariant: **the agent proposes a *structured intent*; the wallet deterministically re-resolves and renders it; the user signs locally; keys never leave the device.** Concretely for an NL swap:

1. User: *"sell 30% of my SNEK at market."*
2. The LLM returns **only** a structured intent `{action:swap, sell:SNEK, pct:30, mode:market}` — **never a transaction.**
3. The **wallet** (not the LLM) resolves SNEK's unit, **re-resolves ticker→policyID against Gero's own market registry and REJECTS on mismatch**, computes 30% of the *actual held balance* from sync state, and calls the real Nexus `/api/aggregator/quote`.
4. A **propose card** renders exact you-pay / you-receive / route / price-impact / aggregator-fee, with the triangulated risk verdict inline (Fluxpoint `/token-analysis` + Xerberus + in-house liquidity/holders).
5. The wallet **rebuilds and diffs the CBOR** against the intent; any output/recipient/amount delta → REJECT. `cardano-shield scanTx` runs before the sheet.
6. User taps **Sign** → existing `FixedTransaction` detached-witness path produces `userWitnessHex` without re-serializing the opaque `unsignedTxCbor` → `/submit` (never retried).

**A hallucinated or injected number can never reach the signer.** This same spine serves "explain this tx before I sign" (decode via `cardanoJsSdkCbor.ts`/`resolver.ts`) and, later, staking/governance cert proposals.

### 5.2 The autonomy ladder — and which level ships first

| Level | What it does | Custody primitive | Ship? |
|---|---|---|---|
| **L0** Informational chat | Reads wallet snapshot, answers | No signing path | **MVP (free)** |
| **L1** Suggest-a-tx, user signs each | Agent emits intent → Guardrail card → local sign | Per-tx local signature | **MVP (the bet)** |
| **L2** Pre-authorized session w/ limits | A **confirmation budget** (max spend, allow-listed protocols/tokens, slippage ceiling, time-box); each tx still passes the deterministic gate | Per-*plan* signature; **NOT a hot session key** | Phase 3, behind guardrail gate |
| **L3** Autonomous DCA/stop-loss/rebalance | **On-chain script-escrow order** — one bounded intent locks funds into a validator with datum-encoded limit price/slippage/deadline; batcher can only execute within limits, never redirect; user reclaims on expiry | On-chain datum limits | Phase 4, framed as *user-defined automated orders*, never "AI manages your money" |

**Ship L1+ first.** It is safe, differentiated, regulation-aligned, and revenue-ready, and **requires no new custody primitive.** Cardano has **no ERC-4337** (dcSpark's account-abstraction proposal never reached mainnet), so the EVM "session key" model is unavailable — the correct analogue is the **intent/script-escrow** pattern (CoW/UniswapX/Aori; DexHunter already ships conditional/DCA this way), which is exactly how we get autopilot UX with **L1-grade custody safety** later.

### 5.2.1 Cardano autonomy models (eUTxO = consent required)

On Cardano every spend needs a witness signature on the specific transaction. There are no session keys, no account abstraction (no ERC-4337), and no spending delegation. That constraint is not a gap to route around; it is the non-custody moat. On EVM, "autonomy" usually means an approval that grants an unbounded allowance, so a single compromised agent has blast radius across the whole balance (the 2026 drain reel in section 2 is exactly this). On eUTxO there is no standing approval an attacker can ride: nothing moves without a fresh signature over the exact bytes of the exact transaction. We should say this out loud as the headline virtue, not treat it as friction.

Given that, there are three ways to deliver agent autonomy on Cardano, in increasing order of how much they relax the per-tx signature:

1. **Per-tx consent made frictionless (L1, ships first).** The agent proposes an unsigned transaction; the user signs it locally after a deterministic Guardrail decode. The cross-device signing bridge (`src/services/crossDevice/`, `docs/plans/2026-06-29-cross-device-signing-bridge.md`) makes this frictionless across devices: a desktop copilot proposes, gero-sync relays the unsigned tx to the phone, the phone independently decodes and displays the real amounts and recipients, the user biometric-signs locally, and the witness returns. Private keys never leave the signing device; gero-sync only relays the unsigned tx and the signature. This is the Cardano-native, non-custodial equivalent of MetaMask Agent Wallet's "out-of-policy routes to mobile push approval" (section 4.1), except the phone is a full independent signer, not a rubber stamp.

2. **Key-isolated bounded allowance jar (L2).** A separate hot sub-account funded to a capped amount that the agent may spend from within per-payment, daily, and total limits, with a default-deny allowlist, expiry, and kill-switch. The isolation is the safety: the agent can never exceed the jar because the rest of the wallet's keys are not reachable. This bounds blast radius to the jar balance, unlike an EVM allowance that exposes the full balance.

3. **On-chain validator-enforced jar (L3).** One bounded intent locks funds into a validator with datum-encoded limits (limit price, slippage, deadline). A batcher can only execute within those limits and can never redirect funds; the user reclaims on expiry. Here the on-chain script, not a trusted key holder, enforces the bound. This is the intent/script-escrow analogue and the only model that gives true unattended automation while keeping custody safety.

The through-line: each model keeps the "no transaction without a signature or an on-chain rule" property, so at no point does Gero or gero-sync become a custodian. That is the positioning we should lead with against custody-undisclosed competitors.

### 5.3 MVP feature set (5 features — 4 are low-complexity reuse)

The MVP **leads with the free frequent painkiller**, not the paid chat:

| # | Feature | Complexity | Value | Role | Cost rail |
|---|---|---|---|---|---|
| **1** | **Pre-sign Safety Verdict** — decode the actual CBOR (`cardanoJsSdkCbor.ts`/`resolver.ts`), narrate inputs/outputs/certs/which-dApp/unexpected outflows; fuse Xerberus + in-house liquidity/holders + `cardano-shield scanTx`. **Auto-fires on every sign sheet.** | LOW | **HIGH** | **Free, viral, the wedge** | **Deterministic, NO LLM call → ~$0 marginal** |
| **2** | **Portfolio Analyst & P&L narrator** — assemble `getWalletPnl` + holdings + history into `/chat` context; narrate winners/losers, allocation risk, realized gains | LOW | HIGH | Plus-tier gateway (reflection) | Metered `/chat` |
| **3** | **Natural-Language Swap** via Nexus aggregator + Guardrail card | **MED** | HIGH | **Direct revenue flagship** | Swap take-rate |
| **4** | **Triangulated pre-trade rug/risk screen** — flat-billed `/token-analysis` + Xerberus + market-API; auto-fires before any swap confirm | LOW | HIGH | Trust-enabler | Flat-billed (≈$0/turn) |
| **5** | **Portfolio Q&A chat** | LOW | MED | Engagement / metered usage | Metered `/chat` |

**Deliberately LATER:** NL perps (**hard-gated** behind the 2.7 Strike auth fixes — the audit shows the authed trading surface is currently broken: sidepanel crash, blank account, unsigned authed queries, missing withdraw-batcher; shipping NL perps on that path would lose user funds). DCA/limit-by-chat (Nexus aggregator is **market-only** today). L3 autopilot, staking/governance optimizers, cross-protocol yield via cardano-defi-skills operators.

### 5.4 The non-custodial propose-then-sign UX

Reuse the existing CIP-30 pipeline (`background.ts METHOD.signTx → SignTx.vue`, Nexus `tx_cbor`, `cardano-shield-api.ts` pre-sign threat scan). The agent is an **additive layer — a chat panel + a tool router — not a rewrite.** Add a deterministic CBOR decode + a simulation/preview line so the user sees exact deltas (matching the MetaMask Agent Wallet bar of mandatory simulation). **Host the streaming loop in the persistent sidepanel** (the MV3 service worker is ephemeral and lacks EventSource); consume `/chat` via `fetch()` + `ReadableStream.getReader()` + `TextDecoder` (EventSource can't set the required `api-key` header). **Add the single Fluxpoint host to the manifest `connect-src` allowlist behind one pinned, audited origin** (it is absent today — *nothing connects without this one-line change*).

---

## 6. Monetization & Unit Economics

### 6.1 Revenue model

- **Primary (M1–M12 engine): subscription.** Cardano spot-swap fees are too thin to lead (see 6.4). The subscription monetizes the **reflection + action** layer.
- **Secondary (the scale lever): swap take-rate** on AI-routed trades via the Nexus `aggregatorFeeLovelace` rail — **small on Cardano, compounds 10–100x on BTC/Solana/ETH.**
- **Tertiary:** on-ramp affiliate markup ~1% (Moonpay/Guardarian "help me buy ADA" funnel), tax-export one-shot, and (Phase 2, Pro-only, opt-in) a performance fee on agent-defined strategies — **shipped last** for trust/regulatory reasons.

### 6.2 Two red-team corrections that change the model

**(a) The swap rail is UNBUILT in the extension and the price story was backwards.**
- Verified: `docs/plans/2026-06-24-dexhunter-nexus-cutoff.md` is *"Proposed — not started"*; `nexus-tx-api.ts` implements `/api/tx/build` only, **not** `/api/aggregator/*`. The aggregator-fee rail exists **on iOS only.** → **Porting the proven iOS aggregator implementation is a hard prerequisite milestone; until it ships in the extension, swap-fee revenue is $0.**
- DexHunter's effective ~0.3–0.5% **is the underlying DEX pool fee** — there is no confirmed separate markup. A Gero **service** fee sits **on top** of those pool fees, making Gero *more* expensive than going direct. → **We do NOT claim a price win.** We either (i) keep the service fee modest (0.25–0.5%) and **justify it on AI value + risk-screening + bundled P&L**, or (ii) run a real fee-tolerance A/B among active traders before committing. The Pro tier discounts the fee to 0.25%.

**(b) The free tier is the COGS risk, not the paid tier.** A free power-user resending the **full wallet snapshot to a stateless endpoint every turn** is pure loss. **Mitigation (architectural, not optional):**
- The **Safety Verdict and risk screen run deterministically with NO `/chat` call** (flat-billed `/token-analysis` + Xerberus + in-house data) → ~$0 marginal, abuse-proof.
- **Per-wallet rate limits** + **context diffing/redaction** (send only the single tx / task-relevant slice, never full history — this is also the GDPR/PII fix).
- LLM **narration** gated behind a per-day free cap or Plus.

### 6.3 Unit economics vs Fluxpoint cost

Kimi inference is cheap: **$0.95/M input, $4.00/M output, $0.16/M cached input.** A turn (~6k in + 600 out, full context resent) ≈ **$0.0034 cached / $0.0081 uncached**; blended tool-calling ≈ $0.006–$0.012. `/token-analysis` is **flat-billed** (≈$0 token cost). A median payer at 60 interactions/mo ≈ **$0.40–0.72**; a whale at 150/mo < $1.80. **COGS is <8% of even a $9.99 plan.** *(Assumptions: 6k/600 token budget and ~50% cache-hit are estimates; the dominant uncertainty is conversion, validated by paywall A/B before committing ARPU.)*

### 6.4 Cardano fee ceiling (why subscription must lead)

At ~$100M/mo DEX volume and a 0.5% service fee, **100% capture of ALL Cardano swap volume ≈ $6M/yr**; a realistic 5–10% share ≈ $300–600k/yr. With **TVL now ~$91M and falling** and top-3 weekly volume ~$16.36M, the honest near-term capture is **low-five-figures/yr** (10% of flow × 0.25% ≈ **$5.7k/mo**). **This is a feature-funding number, not a company-funding number** — hence subscription-led, multi-chain-scaled.

### 6.5 Three-tier pricing (what's gated)

| Tier | Price | What's included | What's gated above |
|---|---|---|---|
| **Free** | $0 | Wallet + portfolio + staking + manual swaps (take-rate applies once shipped); **Pre-sign Safety Verdict (deterministic, unlimited)**; read-only token risk scores; ~30 LLM chat/ask actions/mo | Agent-initiated trades; unlimited AI; advanced P&L; tax export |
| **Plus** | **$9.99/mo · $99/yr** | Unlimited conversational AI; full risk scoring on every token; **trade copilot that DRAFTS swaps (user signs)**; 1,000 AI-action credits/mo; reduced swap fee 0.5%; multimodal (chart/image) input | DeFi-skills execution; DCA/limit/rebalance; defi-portfolio aggregation; performance-fee strategies |
| **Pro** | **$29.99/mo · $299/yr** | Everything in Plus + agent execution across the 9 protocols (Strike perps¹, Indigo CDPs, Bodega, lending); agent-defined DCA/limit/rebalance (L3 script-escrow); defi-portfolio aggregation; fair-use "unlimited" credits; swap fee 0.25%; priority throughput; **(Phase 2) opt-in 10% performance fee** | — |

¹ Perps gated behind the 2.7 Strike auth fixes + a registered-intermediary routing path. **GERO/ADA payment discount ~15–20%** as a token *sink* (no new mint).

### 6.6 Illustrative P&L (gross of opex; stated assumptions)

*Assumptions: blended inference COGS ~$0.60/payer/mo; own-infra ~$0.50/payer/mo (already sunk, allocated marginally); ~5% payment processing; 70% Plus / 30% Pro → subscription ARPU ~$15.99/mo; + ~$1.50/mo blended swap/affiliate per payer → gross rev/payer ~$17.50/mo. COGS stays ~6–7% of revenue at every tier.*

| Paying users | Annual revenue | COGS (inference+infra) | Gross profit (pre-opex) |
|---|---|---|---|
| 1,000 | ~$210k | ~$13k | **~$190k** |
| 10,000 | ~$2.10M | ~$132k | **~$1.9M** |
| 50,000 | ~$10.5M | ~$660k | **~$9.7M** |

**The realism check (red-team-corrected):** Gero has **~9k installs**. At **35–45% activation × a realistic 4–6% conversion**, that's **~150–350 payers → ~$5k–12k MRR** at M12 — *roughly 10x below the earlier $50–120k MRR claim built on a 40–60k base and 8–12% conversion.* **That is fine for a wedge.** Reaching the 10k-payer row requires growing the base **5–10x AND multi-chain expansion** — which is precisely why the strategy pairs subscription with the compounding multi-chain swap-fee layer. **Install growth is the explicit gating milestone; every downstream number rides this denominator.**

---

## 7. Technical Architecture

**Feasibility verdict: FEASIBLE, and lower-risk than it looks — because Gero already built the hard part.** The non-custodial propose-then-sign core exists today (CIP-30: `background.ts METHOD.signTx → SignTx.vue`; Nexus `tx_cbor` in `nexus-tx-api.ts`; pre-sign scan in `cardano-shield-api.ts`). Effort: **Medium** for MVP (read-only Q&A + swap/transfer proposing through the existing sign sheet + porting the iOS aggregator rail); **Large** for MetaMask-parity safety + multi-chain + injection hardening.

**Orchestration lives Gero-side, definitively.** `/chat` is **stateless** (resend context every call) and **`reply_json` is always null** — no native structured-output channel. Fluxpoint exposes function-calling only as **SSE `tool_call` frames**, and the tools it would call (Nexus build/aggregator, market-data, gero-sync, cardano-defi-skills operators) are **Gero's private infra Fluxpoint cannot reach.** Pattern:

```
sidepanel → fetch(/chat, api-key) → stream SSE
  ├─ frame: content/reasoning → render
  ├─ frame: tool_call → ROUTER validates every arg (amount, policyId, recipient)
  │         → executes locally against Gero backends
  │         → result fed back on the NEXT /chat call (+ re-sent, redacted context)
  └─ frame: tool_result → Guardrail re-derives → propose card → user signs locally
```

The router **parses frame types, never prose** — so `reply_json: null` is irrelevant. **Fluxpoint stays a pure brain with zero access to funds or infra** — exactly the isolation a non-custodial product wants.

**Feeding wallet state safely.** The `context` field is **explicitly untrusted** and carries on-chain text (token names, NFT descriptions) — an **active injection vector.** Rules: **redact to need-to-know** (positions relevant to the intent; never seed/keys/full history); **escape and delimit all on-chain strings as DATA, not instructions**; and **never let the LLM's words determine value movement** — amounts/recipients on the sign sheet are decoded by Gero from the actual CBOR.

**Prompt-injection defense (the top, existential risk).** Consensus: LLMs cannot separate instructions from data in one context window — defense must be **architectural**, not prompt-level:
1. The agent **never authorizes value** — only the user's local signature does, against **Gero-decoded ground truth.**
2. **Sanitize/delimit** on-chain text before the model sees it.
3. A **deterministic policy gate** (spend caps, contract/token allowlists, slippage clamp) + `cardano-shield scanTx` runs on **every** proposed tx before the sheet.
4. The router **validates every `tool_call` argument as if it came from a hostile dApp.**
5. **Hard rails over soft rails:** per-tx local signing (L1/L2) and on-chain datum limits (L3). Soft JS-only rails are "discouraged, not impossible" and will eventually be bypassed.

This is the verbatim lesson of the 2026 post-mortems: *"distrust decoded content by default; treat every action as untrusted."* Every published catastrophe happened because the agent could sign directly. **We make that impossible by design.**

**Single-vendor abstraction.** Wrap Fluxpoint behind an **`AgentProvider` interface** — `chat(messages, context, tools) → AsyncIterable<Frame>` — so a second provider or a Gero-hosted model is swappable **without touching the router or UI.** Critically, **abstract the metering/billing rail too, not just chat** (see §9). Keep **all execution on Nexus** so a Fluxpoint outage degrades to *"no chat,"* never *"cannot trade."*

**Top technical risks:**
1. **The aggregator-swap rail is unbuilt in the extension** (iOS-only) — prerequisite milestone with two gating invariants (opaque CBOR never re-serialized; non-idempotent `/submit` never retried).
2. **MV3 streaming** must live in the sidepanel/offscreen doc, not the service worker; CSP `connect-src` must add the Fluxpoint host.
3. **Prompt injection** — mitigated architecturally above; the Guardrail is a **gating prerequisite to any agent-proposed tx.**
4. **Stateless context resend** — latency + token cost + PII surface; mitigated by redaction/diffing.

---

## 8. Multi-Chain Roadmap

**Sequence:** **Cardano (beachhead) → Bitcoin (#1, weeks) → Solana (#2, Medium) → Midnight (#3, in progress) → EVM bundle (#4, Large) → remaining top-20 (opportunistic).**

**Chain #1 — Bitcoin (the highest-ROI move, and it isn't a new chain).** The repo already contains a **complete, gated Bitcoin stack** (`src/chains/bitcoin/`: PSBT builder, coin selection, fee estimator, UTxO manager, hardware signer, tx sync) + Babylon/Lombard staking, Ordinals, Thorchain, Lightning. The 2.7 "HIDE+GATE" switch in `networks.ts` severs *user access, not code.* Because BTC is UTxO, the propose-then-sign pattern is **identical to Cardano's** (API → unsigned PSBT → local sign → submit). **Rationale for #2-as-BTC:** largest holder base, a high-trust native-staking AUM hook (~$200B TAM, Bitwise), and **zero account-model tax** — a 2-chain Smart Wallet in *weeks* of "wrap what exists."

**Chain #2 — Solana (the revenue-ceiling decision).** Solana is where **agentic value settles**: ~65% of agentic AI payments, ~65% of x402 volume, ~$31B agent payment volume in 2025, 400ms finality, $0.00025 fees. **Fluxpoint `/token-analysis` already covers Solana**, so the read-only AI layer (risk scoring + portfolio chat) ships **free** the moment a Solana portfolio view exists. Paid work = the action layer: Ed25519/SVM signing, `m/44'/501'` derivation, Nexus Solana indexing (genuinely Medium). Chosen over ETH for #2 because it's **agent-native** — the metered-mode and x402 primitives compound there and trade volume/user is highest.

**Chain #3 — Midnight (differentiation, not volume) + the privacy+AI angle.** Already mid-integration (Nexus sidecar, gero-sync owns address state, V16 UTxO ledger writer); UTxO-style so it reuses local-sign rails; **mainnet live 31 Mar 2026** with institutional validators (Worldpay, MoneyGram, Google Cloud, eToro). **The unique AI angle:** a **local-only assistant that reasons over shielded balances and DUST regeneration on-device** — *"you have X DUST capacity, regenerating to cover N more private txs in T hours; here's the cheapest way to sequence your shielded actions."* No competitor can replicate it. **The discipline:** Fluxpoint keeps no session memory and you resend context in an untrusted field — **shipping shielded balances in cleartext to a cloud LLM would defeat the privacy thesis.** So Midnight **forces a local-context/redaction architecture** — good hygiene to retrofit onto *every* chain. Midnight also doubles as a **compliance asset**: ZK selective-disclosure is "compliance-ready" (GDPR/CCPA), a regulatory selling point. *(Caveat: `/token-analysis` does NOT cover Midnight or Bitcoin — the value there is privacy-aware portfolio reasoning / staking explainers, not token risk scoring.)*

**Chain #4 — EVM bundle (the TVL ceiling).** One secp256k1/EIP-1559 adapter unlocks **Ethereum (~$55.6B TVL) + Base + Polygon + Arbitrum + Optimism** on the same EntryPoint. Largest single lift but broadest payoff; **lead read-first** (risk scoring + portfolio free via `/token-analysis` for Base/Polygon/Avalanche/ETH), then layer ERC-4337/intents signing.

**The cross-cutting moat:** porting Gero's **market-data API + Nexus** (grounded, first-party read surface) to each chain is what lets the agent **out-reason competitors renting third-party APIs.** Each chain attaches the same four monetization layers: (1) flat-billed `/token-analysis` freemium hook; (2) metered agent mode (Bearer/`balance_after`); (3) Nexus aggregator spread + perps; (4) x402 on Solana/Base (sell first-party market-data to other agents). **The AI layer is the asset that travels; routing fees compound 10–100x on the bigger chains.**

---

## 9. Fluxpoint Partnership

Fluxpoint is **the only external dependency** — and the dependency is **deeper than "the brain."** It also owns the **metering/billing primitive** (Bearer → `balance_after`) the Pro tier leans on, **and it owns Saturn Swap (a Cardano DEX)** — a structural conflict, since Gero's aggregator routes flow a competing interest could want to steer.

**Recommended commercial structure (HYBRID):**
- **Cost-plus on inference** (metered `/chat`, flat `/token-analysis`) to protect a predictable **75–85% gross margin**, plus a **modest 10–15% rev-share on NET SUBSCRIPTION revenue ONLY** — **never on routing/trading fees** (those ride Gero's own Nexus rails and stay 100% Gero).
- **Category exclusivity:** Fluxpoint won't power a competing **Cardano-native consumer wallet copilot** for the term (free to serve dev/non-wallet customers). **Make exclusivity a go/no-go gate** for any deeper coupling — if unobtainable, the moat thesis weakens and we lean harder on the `AgentProvider` fallback.
- **Hard SLAs:** ≥99.5% uptime, p95 latency ceiling, **documented API-key rotation + billing/on-call escalation runbook** (project memory already records stale-key/billing incidents — a live revenue risk).
- **Saturn-Swap conflict-of-interest carve-out:** contractual guarantee that Gero's aggregator routing cannot be steered toward Saturn.
- **Co-marketing:** joint launch + case study.

**The API-key/billing fix (specific):** the stale-key/billing incidents in project memory sit on the **critical revenue path.** Required: documented key-rotation, on-call escalation, and **billing-failure fallbacks** so a key/billing hiccup degrades to free conversational mode rather than breaking metered Pro.

**De-risking the single vendor (architectural):** abstract **BOTH chat AND the metering rail** behind swappable providers — not just chat. Stand up a **non-Fluxpoint fallback for metering** and a **second/self-hosted model path** for narration. Keep all execution on Nexus. The wallet is already the integration brain (it must own context assembly + SSE parsing because `/chat` is stateless and `reply_json` is null), so the abstraction is cheap to enforce.

**Token angle (skeptical):** **do not mint a new utility token** for the AI layer (securities risk + dilution). Use existing GERO **only** as an optional discount/payment rail (pay Pro in GERO at a discount; stake to unlock a lower routing-fee tier) — a **sink**, framed as fee rebates tied to real volume to avoid farm-and-dump.

---

## 10. Regulatory & Risk Register

**Bottom line:** Gero can launch on the right side of the law **only if it stays a NON-ADVISORY, NON-CUSTODIAL information-and-execution tool.** 2026 gave both the precedents (Coinbase Advisor registered as RIA, 16 Jun 2026; SEC dismissed broker-dealer claims vs MetaMask; SEC Covered-UI-Provider safe harbor; **CFTC/Phantom no-action letter 26-09, 17 Mar 2026**) and the cautionary tales (Grok/Bankr drain). **The single highest-leverage decision: the agent EDUCATES and PROPOSES, never makes PERSONALIZED recommendations or signs autonomously.**

| # | Risk | Severity | Mitigation (must-have guardrail) |
|---|---|---|---|
| **1** | **"AI drained my wallet"** (prompt injection via on-chain text — Bankr ~$150k, Step ~$40M) | **Existential** | **Mandatory per-tx human signature; NEVER ship auto-sign.** Architectural injection defense (§7). Make *"the AI literally cannot set the number you sign"* the headline. Note: local signing prevents autonomous drains but a socially-engineered Sign still loses funds → the deterministic Guardrail re-derivation + clear propose card is the second line. |
| **2** | **Advice line (MiCA)** — "advice" = *personalised recommendations*; **transitional period ends 1 Jul 2026.** After it, advice needs CASP authorization + Art. 81 suitability (EU) / tracks the Investment Advisers Act 1940 (US) | High | System prompt + UI **forbid personalized buy/sell/hold**; output framed *"information / not financial advice"*; refusal-to-personalize pattern. **Remove "will this rug me / is this safe / should I buy" verb framing** — surface **objective data** (liquidity $X, top-10 hold Y%, unverified contract, unexpected outflow) and let the user conclude. |
| **3** | **Perps straddle the line** — the fee-base scale-lever (Strike 1–125x) is **also** the highest-liability surface (leveraged-derivatives recommendation + "AI told me to") | High | **Defer NL-perps** until BOTH the Strike auth fixes AND a **registered-intermediary routing path** exist (per CFTC/Phantom). Extra disclaimers on the perps surface. |
| **4** | **Liability for AI-caused losses** — courts won't enforce waivers for gross negligence/willful misconduct/**known-and-undisclosed defects** | High | The **human signature** is the control. Disclaimers **conspicuous, click-wrap accepted, repeated at each AI suggestion** — not buried in ToS. **Known-defect monitor:** log every verdict, watch for false-"low-risk" on tokens that later rug, **fix-or-warn** loop. |
| **5** | **GDPR** — wallet snapshot in `context` = personal data sent to Fluxpoint; Gero remains controller | High | **DPA with Fluxpoint**; lawful basis + transfer mechanism; **data minimization on the context field** (redact to task-relevant); erasure/access path. (Fluxpoint keeping no session memory helps the privacy notice.) |
| **6** | **EU AI Act Art. 50** — AI-disclosure at conversation start, **deadline 2 Aug 2026** | Medium | Disclosure at conversation start; avoid any high-risk-triggering "consequential decision" component. |
| **7** | **US neutral-interface safe harbor** | Tailwind (maintain) | Never custody; route derivatives through registered intermediaries; **balanced (NFA-style) marketing**; venue-neutral or disclose routing economics; no disqualified principals. |
| **8** | **Reputational/trust is binary** — one viral drain narrative is hard to recover | High | Same design choice as #1, turned into the headline message + visible incident-response posture. |

**Midnight as a compliance asset:** frame its ZK selective-disclosure as the privacy-preserving rail — a regulatory selling point, not just a roadmap item.

---

## 11. Roadmap & Milestones

| Phase | Scope | Effort | Gate criteria to advance |
|---|---|---|---|
| **Phase 0 — Free Guardrail + Read-Only AI** | Ship **Pre-sign Safety Verdict (deterministic, no LLM)** + Portfolio/P&L narrator + Q&A chat to the **existing ~9k base**, FREE. Add Fluxpoint host to CSP (1 pinned origin). Host loop in sidepanel. In parallel: **fix the 2.7 Strike auth bugs** so the eventual "AI executes a trade" demo is flawless. | Medium | **W4 retention ≥ 25%** on the free read-only cohort (hard kill-criterion: <25% W4 → pivot). Zero-drain safety record. CSP/sidepanel streaming verified. |
| **Phase 1 — Aggregator rail + gated NL-swap beta** | **Port the proven iOS Nexus `/api/aggregator/*` rail** (the two invariants as gating tests). Gated NL-swap beta to top ~500 active traders + Guardrail card. Instrument activation + route savings. **Real fee-tolerance A/B.** | Medium | Aggregator rail live in extension; Guardrail rebuild+diff passing on 100% of proposed txs; **fee A/B shows acceptable tolerance**; install-growth motion (CT/KOL/protocol co-marketing) producing measurable net-new installs. |
| **Phase 2 — Public Copilot Pro launch** | Plus/Pro paywalls; growth loops on (insight cards via `/images`, address-bound referral, 10–20 KOL seeds, 9-protocol co-marketing); tax-export; metering via Bearer/`balance_after` (with non-Fluxpoint fallback). | Medium | **Paid conversion ≥ 4–6%** of active DeFi users at the paywall; subscription COGS confirmed <8% of plan; Fluxpoint commercial terms (exclusivity + SLA + Saturn carve-out) signed. |
| **Phase 3 — Multi-chain (BTC then Solana)** | **Un-gate the built Bitcoin stack** (weeks); then Solana action layer (read layer free via `/token-analysis`). Begin L2 confirmation-budget behind the guardrail gate. | BTC: weeks / SOL: Medium | 2-chain Smart Wallet live; Solana portfolio + risk-screen shipped; swap-fee revenue compounding on BTC/SOL. |
| **Phase 4 — Midnight + EVM + L3 + B2B optionality** | Midnight privacy-aware local-context AI; EVM read-first then ERC-4337 signing; L3 on-chain script-escrow orders; **then** consider the Guardrail-as-a-service B2B play (gated on a proven consumer product). | Large | EVM read layer live; L3 escrow audited; **only then** open B2B (Guardrail/safety oracle to non-wallet dApps, not rival wallets). |

---

## 12. 12-Month Business Case & KPIs

*All figures are estimates on the verified ~9k-install base, deliberately conservative per the red-team. Targets assume the install-growth motion in Phases 1–2 succeeds; if it does not, payer counts scale down proportionally.*

| KPI | M6 (Phase 0→1) | M12 (Phase 2 base) | M12 (bull) |
|---|---|---|---|
| Active installs | ~9k → growth motion live | 15–25k (5–10x is the multi-year target, not M12) | 25–40k |
| Activation (W4 return) | ≥25% (gate) | 35–45% | 45% |
| Free→paid (of active DeFi users) | — | **4–6% (base)** | 8% (top-quartile) |
| Paying users | — | **~150–600** | ~1,000–1,500 |
| Blended ARPU | — | **~$15.99/mo subscription + ~$1.50 swap/affiliate** | ~$17.50/mo |
| **MRR** | — | **~$5k–12k** | ~$20–30k |
| **ARR** | — | **~$60k–145k** | ~$250–360k |
| Gross margin | — | **75–85%** (COGS ~6–8% of rev) | 75–85% |

**Honest framing for the board:** an M12 of **~$5–12k MRR is a credible WEDGE outcome, not a company-funding one** — and the earlier draft's $50–120k MRR was built on an inflated 40–60k base and a top-quartile conversion treated as the base case. **The business case is the *trajectory*, not M12 ARR:** prove the agent + the guardrail + retention on Cardano cheaply, then let the **same AI layer + swap take-rate compound 10–100x on BTC → Solana → EVM** (MetaMask's ~$25M/yr multi-chain annualized is the destination benchmark). **Install growth is the explicit gating milestone; it must lead the payer projections, not follow them.**

---

## 13. Open Decisions for the Founders

1. **Swap-fee positioning.** We cannot honestly claim a price win (a Gero service fee is *additive* to DEX pool fees, making us more expensive than going direct). **Decision:** do we (a) keep the fee modest at 0.25–0.5% and justify it purely on AI value + risk-screening + bundled P&L, or (b) absorb the fee into Pro and monetize swaps only via the subscription? Either way, gate on the Phase-1 fee-tolerance A/B.

2. **Aggregator-rail sequencing.** Porting the iOS Nexus `/api/aggregator/*` into the extension is a **hard prerequisite** to any swap-fee revenue (it's "Proposed — not started" today). **Decision:** do we commit the eng resources to port it *before* Phase-1, accepting that until it ships swap-fee revenue is $0?

3. **Fluxpoint commercial terms as a go/no-go gate.** **Decision:** are we willing to make **Cardano category exclusivity + a hard SLA + a Saturn-Swap routing conflict carve-out** a precondition for scaling the metered tier? If Fluxpoint won't grant exclusivity, do we accept relying solely on the `AgentProvider` fallback and a second model?

4. **Perps timing.** The perps fee-base lever and the MiCA/CFTC advice landmine are the **same feature.** **Decision:** confirm we defer NL-perps until BOTH the 2.7 Strike auth fixes AND a registered-intermediary routing path exist — even though perps are the single biggest near-term fee-base multiplier.

5. **The free-tier kill-criterion.** **Decision:** do we commit to the hard rule that **<25% W4 retention on the free read-only cohort = pivot before funding the paid tier** — treating "try-once" as the default hypothesis to disprove, given documented AI-gimmick fatigue and Yoroi/SecondFi + Fuku in motion?

6. **Advice-line copy discipline.** Removing "will this rug me / is this safe / should I buy" verb framing (to stay inside MiCA's information carve-out) weakens the marketing punch of the safety verdict. **Decision:** accept objective-data-only framing (liquidity $X, top-10 hold Y%, unexpected outflow) as the legal cost of the wedge?

7. **B2B SDK.** The white-label Copilot SDK has the highest revenue *ceiling* but the slowest time-to-PMF, channel conflict with rival wallets, and requires a proven consumer product as its only credibility proof. **Decision:** confirm it stays a **Phase-4 optionality line** scoped to **non-wallet dApps** (Guardrail/safety oracle, not the aggregator DexHunter gives away free), and is **not** staffed until Bet 0 clears its retention gate.

8. **Install-growth investment.** Every revenue number rides the ~9k denominator. **Decision:** what budget goes to the install-growth motion (CT/KOL seeding, protocol co-marketing, founding-member annual pricing) in Phases 1–2, and what net-new-install target gates Phase-2 paid launch?

---

## 14. Cross-Platform Strategy - Native iOS & Mobile

### 14.1 Platform thesis and the revision it forces

The original strategy treats iOS as a later multi-chain-style port. The new fact inverts that. The monetized rail this strategy was built to capture - the 0.25-0.5% AI-routed swap take-rate - **already ships in Swift today**. Per `docs/plans/2026-06-24-dexhunter-nexus-cutoff.md` (line 6), the iOS `NexusSwapService` removal of DexHunter is `completed - 13 commits, +2852/-894, full test coverage` on `origin/feat/dexhunter-full-removal`, with `UtxoCborBuilder`, `SwapTokenResolver`, `SwapFeatureFlag`, and the full `/api/aggregator/{quote,build-tx,submit,status}` flow wired through `aggregatorFeeLovelace` (Gero treasury) and `partnerFeeLovelace`. The browser extension's equivalent aggregator port is explicitly **"Proposed - not started."**

Two consequences follow, and they revise the strategy's spine:

1. **iOS is the more monetization-ready surface, not the trailing one.** The action layer that justifies the take-rate is live on the larger funnel first. The extension is now the surface that has to catch up to iOS on the revenue rail.
2. **The App Store answers the strategy's single biggest admitted weakness.** Section-1-through-13 economics all ride the ~9,000 Chrome-install denominator, and "install growth is the explicit gating milestone." The App Store is a structurally larger discovery funnel than the browser-bound Chrome Web Store (~112k total extensions, browser-locked): ~70% of App Store visitors arrive via search and ~65% of downloads follow a search (ASO 2026 data, https://asomobile.net/en/blog/aso-in-2026-the-complete-guide-to-app-optimization/), and finance is the highest push-opt-in category in mobile. **iOS is the lever that grows the denominator every revenue line divides by.** Even at a 15% Apple cut on subscriptions, 10x the installs beats 95%-net on a tiny base.

Net revision: **iOS leads monetization and acquisition; the extension becomes the desktop / dApp-signing power-user surface.** The thesis ("agent proposes a structured intent, user signs locally, keys never leave device") is unchanged - it ports cleanly and, as 14.4 shows, gets *stronger* on-device.

### 14.2 App Store monetization reality - the cut is ~10 points, not 30

The reflexive "Apple takes 30%" assumption materially understates mobile net margin, because Gero's three revenue lines fall into three different policy buckets and only one is taxed.

| Revenue line | Apple/Google policy bucket | Effective platform cut | Net vs web |
|---|---|---|---|
| **AI-routed swap take-rate (0.25-0.5%)** | "Consumed outside the app" crypto transaction, Guideline 3.1.3(e) / 3.1.5(iii) | **~0%** | Parity - keeps 100% |
| **Crypto on-ramp (buy ADA, MoonPay/Guardarian)** | Outside-app transaction settled by Apple Pay/card, 3.1.3(e) | **~0%** | Parity - keeps 100% |
| **$9.99 Plus / $29.99 Pro subscription** | "Unlocking features/subscriptions/premium content" - IAP mandatory, 3.1.1 | **15%** (Small Business Program, <$1M proceeds) | ~10-pt gap, not 30 |

Sources: Apple App Store Review Guidelines 3.1.1 / 3.1.3(e) / 3.1.5 (https://developer.apple.com/app-store/review/guidelines/); Apple Small Business Program 15% under $1M (https://developer.apple.com/app-store/small-business-program/). Precedent that swap fees are untaxed: MetaMask, Phantom, and Trust Wallet all charge in-app swap fees (~0.85%) and pay Apple $0 (https://thedefiant.io/news/nfts-and-web3/apple-lifts-ios-restrictions-allowing-bitcoin-crypto-payments-nfts-ends-30-apple-91233418).

**The swap rail - the thing already built on iOS - is the thing Apple barely touches.** That is the whole point of 14.1: the most monetization-ready surface carries ~0% platform drag on its primary revenue line.

**Keeping the take-rate and on-ramp off-IAP.** Both are "goods/services consumed outside the app" (3.1.3(e)) on an exchange-style crypto rail (3.1.5(iii)), settled on-chain or via Apple Pay/card - never StoreKit. As-built, `NexusSwapService` routes `aggregatorFeeLovelace` on-chain to the Gero treasury, so it is Apple-safe today with zero code change.

**Subscription net-ARPU by rail** (illustrative, on $9.99/mo gross):

| Rail | All-in fee | Net ARPU | Availability |
|---|---|---|---|
| Web / extension (Stripe) | ~4-6% (2.9% + $0.30 + ~0.7% Billing) | **~$9.40-9.55** | Everywhere (off-platform) |
| US iOS web-steer link (Stripe) | ~4-6% | **~$9.40-9.55** | **US storefront only**, today |
| EU alternative terms (CTC) | ~7% all-in | **~$9.10-9.30** | EU, via web distribution |
| iOS IAP (Small Business) | 15% | **~$8.49** | Global default |

Stripe pricing: https://stripe.com/pricing. EU Core Technology Commission ~5% + 2% acquisition + 0-13% store services -> as low as ~7% all-in: https://www.revenuecat.com/blog/growth/apple-eu-dma-update-june-2025/.

**External-link / DMA options.** Post-Epic, US-storefront apps may show buttons/links to web checkout with **no entitlement and, as of June 2026, $0 commission** - the Ninth Circuit (Dec 11, 2025) ruled Apple *may eventually* charge a "reasonable" fee but remanded the number; zero remains in effect pending the district court (https://www.macrumors.com/2025/12/11/apple-app-store-fees-external-payment-links/). So on **US iOS** Gero can legally show "Subscribe on the web for a better price," route margin-sensitive Pro users to Stripe at ~95% net, and dangle a web-only carrot (**$89/yr web vs $99/yr IAP**). Outside the US (ex-EU), anti-steering still forbids the link - those users pay IAP. The EU path is Apple's alternative terms at ~7% all-in.

**Hard prohibition - the GERO/ADA token-sink cannot be an in-app unlock.** Guideline 3.1.1 explicitly bans "using cryptocurrencies and cryptocurrency wallets" as an in-app unlock mechanism. **An iOS user must not be able to unlock Pro by holding/paying GERO inside the app - that is a near-certain rejection** and is the single most likely rejection trigger in the entire strategy. The token discount has to live as a **web-account perk applied off-platform**, then reflected in the user's entitlement - never an in-app paywall mechanic. (Same logic on Google Play.)

**Recommended split:**
- **Via IAP (15%):** the AI subscription, as the default/frictionless path everywhere, and the *only* path for non-US, non-EU users.
- **Off-platform:** (a) US iOS compliant web-subscribe link at Stripe economics with the $89/yr incentive; (b) GERO/ADA discount, strictly a web-account perk; (c) on-ramp via Apple Pay/card.
- **Untaxed entirely:** the swap take-rate (already live) and the on-ramp affiliate spread.
- **Free, LLM-free, disclosure-free:** the Safety Verdict, as habit-forming top of funnel.

**Quantified P&L drag (revising the mobile-cohort economics).** If the section-1-13 model applied a flat 30% to all mobile revenue, correct it to: **swaps ~0%, on-ramp ~0%, subscriptions ~10-15% blended** (mix of US web-steer ~5% and IAP 15%). **Effective platform drag on *total* mobile revenue is realistically ~8-12%, not 30%.** For a mobile cohort whose revenue mix tilts toward the already-built swap rail plus on-ramp, blended drag sits at the low end of that band. Two compliance must-dos are the real cost, not the cut: a 5.1.2(i) AI-consent screen (14.8) and removal of any in-app crypto-unlock. **Google Play is the friendlier twin:** non-custodial wallets are out of scope of the Oct 29, 2025 crypto-licensing policy (no MiCA/FCA/FinCEN - https://decrypt.co/335134/google-non-custodial-wallets-exempt-new-crypto-app-rules-play-store), swaps/on-chain value are not "in-app digital content," and the AI sub sits at Play's 15% under-$1M tier. **Ship Android alongside iOS, not after.**

The one timing caveat: the US $0 external-link window is on a clock (the court will set a "reasonable" fee, plausibly ~10-27% within 12 months), so capture the web-steer ARPU rescue now and stress-test the model against a ~10-27% US external path.

### 14.3 Mobile-native AI surfaces - the surfaces that beat the extension

A Chrome extension can only reach a user while the browser is open. The strategy's entire free-painkiller habit loop depends on reaching users **when they are not looking** - which is structurally a mobile-only capability. Ranked by wedge value:

1. **Proactive push AI alerts (the #1 wedge, and the always-on trade-assistant the extension cannot be).** "Your SNEK position is down 20%" / "token X just lost 80% of its pool liquidity" / "Xerberus risk on your holding just changed." The **trigger is deterministic** - price/liquidity/risk thresholds off Gero's own 12-DEX market data + Xerberus - so it makes **no LLM call and costs ~$0 at scale**, matching the free-tier economics exactly. The retention case is strong: a single push in the first 90 days lifts 90-day retention ~147%, push cohorts retain up to 20pp better at 30 days, fintech CTR runs ~17%, and finance leads all industries in push opt-in (Pushwoosh 2025: https://www.pushwoosh.com/blog/push-notifications-fintech/). **This is the mechanism that converts a passive ~9k base into a daily-active, alert-driven funnel.**
2. **Share-sheet / paste "Is this safe?" Safety Verdict.** Drop in any address/token/tx from anywhere on the phone, get the deterministic verdict. Viral, low-build, mobile-only ergonomics, and (like the alert) no third-party AI call - so it sidesteps the 5.1.2(i) consent burden entirely.
3. **Lock-screen + home-screen widgets** - portfolio value, top mover, one-tap "explain." Passive daily surface the extension has no analogue for.
4. **App Intents / Siri Shortcuts** - "Is SNEK safe to buy?" / "What's my ADA P&L?" Parameterized finance-domain intents that also expose Gero to Apple Intelligence's finance domain.
5. **Live Activities on pending swaps/stakes** - reuses the existing aggregator status-poll (`/api/aggregator/status`).
6. **Face ID-gated signing** (positioned accurately - see 14.4 / 14.8).

**Mobile MVP surface set:** (1) deterministic push alerts + (2) share-sheet Safety Verdict - the free, $0-LLM habit loop - shipped **on top of the already-live `NexusSwapService` monetized rail.** Widgets, App Intents, and Live Activities follow. Note the constraint: push/Live Activities are budget-throttled (4KB payload, 8h Dynamic Island / 12h lock-screen caps, frequent-update entitlement), so alerts must be high-signal and user-thresholded, or iOS throttles them and users opt out.

### 14.4 On-device AI as a second AgentProvider

The strategy already mandates wrapping the model behind an `AgentProvider` interface (swappable model) with a separately abstracted metering rail. Apple Foundation Models slots in as a **second AgentProvider**: a ~3B-param on-device LLM with structured output and tool calling, **$0 inference cost, no per-token bill, no network round trip, no data leaving the device** (https://machinelearning.apple.com/research/introducing-apple-foundation-models). Private Cloud Compute offers a 32K-token reasoning tier when the local model is too small.

**Its role is NARRATOR, not Guardrail.** It explains already-computed deterministic facts ("your portfolio is up 4%, driven by SNEK"; "this verdict flagged the token because pool liquidity dropped") in plain English at **zero marginal cost - protecting the gross margin the subscription tiers depend on.** It must never *compute* a safety verdict (a ~3B model with finite context can hallucinate); the Guardrail math stays deterministic and server-side (14.5).

**Its killer use is Midnight privacy.** Reasoning over **shielded balances on-device** means cleartext shielded amounts never reach a cloud LLM - the only architecturally honest privacy story, and one no cloud-LLM wallet can copy. This makes Foundation Models the natural privacy rail for the Midnight phase of the multi-chain sequence, a category-defining differentiator.

**How it slots in:** Foundation Models is the default narrator/Midnight-reasoner on capable hardware (iPhone 15 Pro+/M-series); **Fluxpoint is the fallback** on older devices and the extension, and remains the multi-chain market brain via `/token-analysis` (which is flat-billed and, regardless, does not cover Bitcoin or Midnight). Capability-gate by device; degrade gracefully to Fluxpoint.

### 14.5 Cross-platform architecture - one Guardrail, enforced once in Nexus

The team ships **native Swift** (not React-Native), which is the correct call for security and signing UX - but it means the Swift client and the TS extension **share no client code, only the Nexus contract.** That makes *where the logic lives* the central architecture decision, and the answer is: push the agent tool-router and the deterministic Guardrail into Nexus as **one shared intent API serving both clients.**

The strategy's own facts force this:
- Fluxpoint is **stateless** (resend context every call), `reply_json` is **always null**, and function-calling is **SSE tool-call frames only** - so orchestration *must* live Gero-side, in a server-side tool router.
- Nexus already owns UTxO access, tx building, and the swap aggregator.
- The swap plan proves both clients already hit the **identical `/api/aggregator/{quote,build-tx,submit,status}` contract** - so the precedent for "one Nexus contract, two thin clients" already exists in production.

**The hard split (the Guardrail invariant, enforced once):**

| Server-side in Nexus (written once) | Client-side, per device (Swift / TS) |
|---|---|
| Agent tool-router + Fluxpoint orchestration | Present the Safety Verdict to the user |
| Guardrail **re-resolution**: ticker -> policyID, real balances, fee math | **Re-derive and diff the CBOR locally** |
| Verdict **computation** | **Sign locally - keys never leave the device** |
| Metering / billing rail (Bearer -> balance_after) | Biometric gate (Face ID) on key access |

This avoids the worst cross-platform failure mode: **a Swift Guardrail and a TS Guardrail drifting into divergent verdicts/CBOR - a correctness and security hazard.** The Guardrail's market re-resolution is the moat; it must be byte-identical across clients, which means it is written once, server-side. The final CBOR diff + signature stay client-side so the non-custodial invariant holds (keys never leave device).

**The iOS `NexusSwapService` is the reference template, not the follower.** It already demonstrates the thin-client pattern against the aggregator contract (`UtxoCborBuilder`, `SwapTokenResolver`, status-poll). The extension's "not started" aggregator port should **mirror `NexusSwapService`**, consuming the same Nexus intent API - so the team builds the swap/intent engine once, not twice.

### 14.6 Revised platform sequencing and roadmap deltas

The platform that leads each phase changes once you accept that the swap rail already ships on iOS and the install funnel is mobile.

| Phase | Original (extension-led) | Revised lead surface | Why |
|---|---|---|---|
| **Phase 0 - Free Guardrail painkiller** | Extension | **Ships on whichever surface reaches users fastest.** The Safety Verdict + push alerts is a *better* product on iOS (push, share-sheet); the extension version ships in parallel for desktop dApp users. | Habit loop needs reach-when-not-looking = push = mobile |
| **Phase 1 - Reflection layer (AI portfolio, FIFO P&L, tax export)** | Extension | **Parallel**, behind the shared Nexus intent API; Foundation Models narrates on iOS at $0 marginal cost | Reflection is read-only; both clients call the same API |
| **Phase 2 - Action layer (AI-routed swaps, take-rate)** | Extension | **iOS LEADS.** `NexusSwapService` + `aggregatorFeeLovelace` is already live; layer the AI-routing narrative on the existing rail rather than wait for the extension's "not started" port | The monetized rail exists in Swift today |
| **Phase 3 - Bitcoin (gated stack)** | Extension | Parallel; Foundation Models cannot help (no Midnight/BTC narration coverage from `/token-analysis`) | Already-built gated stack |
| **Phase 4 - Midnight (privacy + AI)** | Extension | **iOS LEADS** with the on-device Foundation Models shielded-balance reasoner | On-device reasoning is the only honest Midnight privacy story |

**Roadmap deltas:**
- **Pull the swap-fee monetization milestone forward and onto iOS.** It is the most monetization-ready surface and the rail is built; do not gate revenue on the extension's unstarted port.
- **Add Android alongside iOS** (Play is the friendlier twin: ~0% on swaps, 15% on subs, non-custodial out-of-scope of crypto licensing).
- **Build the Nexus intent API before the extension's aggregator port** so the extension consumes it rather than duplicating the engine.
- **Sequence Midnight to lead with iOS on-device reasoning** as the category-defining differentiator.

### 14.7 Revised GTM and install-growth - the App Store de-risks the denominator

Every revenue number in sections 1-13 rides the ~9k-install denominator, and the strategy names install growth as the gating milestone. **The App Store is the install-growth engine that de-risks it.**

- **ASO leads acquisition.** Target long-tail finance intent: "Cardano wallet," "ADA staking," "crypto AI assistant," "Cardano portfolio tracker." ~70% of App Store visitors search and ~65% of downloads follow search (https://asomobile.net/en/blog/aso-in-2026-the-complete-guide-to-app-optimization/); Custom Product Pages now rank organically. iOS + Play discovery dwarfs the browser-bound Chrome Web Store. The realistic target is to grow the denominator by an order of magnitude - the only move that changes the M12 outcome above the strategy's ~$5-12k MRR wedge.
- **Surface "Buy ADA" prominently** - it is both a top-of-funnel acquisition hook for new mobile users *and* an untaxed (3.1.3(e)) on-ramp affiliate revenue line.
- **Mobile growth loops:**
  - **Shareable AI insight cards** - the share-sheet Safety Verdict and "explain my portfolio" outputs render as share cards (a verdict, a P&L snapshot, a top-mover), each a viral acquisition unit that the extension's UX cannot produce.
  - **Push re-engagement** - the deterministic alert channel doubles as the retention loop (single push in 90 days = +147% 90-day retention), converting installs into DAU at ~$0 cost.
- **Surface roles settle as:** iOS/Android = growth + monetization engine; **extension = desktop / dApp-signing power-user surface** (where browser-context signing genuinely wins), not the growth driver.

### 14.8 Mobile risk additions

- **5.1.2(i) third-party-AI consent (net-new since the strategy was written, concrete rejection risk).** Added Nov 13, 2025: apps must disclose and obtain explicit opt-in **before** sharing personal data with third-party AI (https://techcrunch.com/2025/11/13/apples-new-app-review-guidelines-clamp-down-on-apps-sharing-personal-data-with-third-party-ai/). Gero Copilot ships portfolio/holdings context to Fluxpoint - **so the iOS app needs a named pre-Copilot consent screen ("we share X with Fluxpoint") or it risks rejection.** Strategically convenient: the free Safety Verdict makes no LLM call and is exempt, so the disclosure burden attaches only to the paid AI layer - sharpening the "the wallet, not the LLM, does the deterministic work locally" moat narrative.
- **Crypto + AI App Review / rejection risk (3.2.2, 3.1.5).** "AI-routed swaps" can read as "financial trading/money management" to a reviewer and trigger a licensing demand or rejection. Mitigation: (a) **region-gate** AI-routed swaps to where Gero has the right to operate a swap rail; (b) label Copilot output **"not financial advice / informational"**; (c) keep the **"agent proposes, user signs locally, keys never leave device"** framing front-and-center - that propose-then-sign posture is exactly what keeps Gero out of 3.2.2's "must be a licensed financial institution" bucket. **The closer Copilot drifts to "auto-execute," the harder this gets - keep it strictly propose-then-user-signs.** Org-enrollment / developer-KYC (3.1.5(i)) is also required for a wallet.
- **Region gating.** US-only $0 external-link steering; EU on alternative terms; rest-of-world on IAP. A Cardano base that skews global (EU/APAC) means the ~95% web-net is a US-minority outcome, not the blended reality - model subscription ARPU per region, not at the US best case.
- **On-device-AI limits.** Foundation Models is ~3B params, finite context ("a 20-page PDF does not fit"), iPhone 15 Pro+/M-series only. It can hallucinate if misused for safety-critical reasoning. Mitigation: narrator-only, Guardrail math stays deterministic/server-side, capability-gate by device, fall back to Fluxpoint.
- **The false hardware-signing claim (correct the strategy here).** The Secure Enclave supports **only P-256 (secp256r1)**; Cardano's Ed25519 and BTC/EVM secp256k1 **cannot be hardware-signed in it** (https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave; https://scryptplatform.medium.com/turn-every-smartphone-into-a-bitcoin-hardware-wallet-using-secure-enclaves-2037d7ccbf5d). **Do not market "hardware-signed Cardano txs in the Secure Enclave" - it is technically false and a trust/compliance liability.** Correct design: the spending key stays encrypted (ChaCha20-Poly1305/PBKDF2, same as the extension); the Enclave P-256 key + Face ID **gates decryption/access**, not the Ed25519 signature itself. Position it accurately as **biometric-gated software signing** (still strictly better UX than the extension's password prompt); reserve true hardware-backed claims for PRF/passkey and Ledger/Trezor/Keystone.
- **Cross-platform Guardrail-duplication risk.** If the Guardrail/tool-router is forked into Swift *and* TS, the two re-resolution paths drift into divergent verdicts/CBOR - a correctness and security hazard. Mitigation is 14.5: single Nexus intent API, clients only present + diff + sign.

### 14.9 New open decisions for the founders

1. **Lead-platform call.** Recommendation: **iOS leads monetization and acquisition; Android ships alongside; the extension becomes the desktop/dApp power-user surface.** Confirm the team has the iOS/Android bandwidth to make mobile the growth engine rather than a port. (The swap rail being already-built on iOS is the tiebreaker.)
2. **IAP-vs-external-payment strategy.** Recommendation: **IAP (15% SBP) as the global default; US web-steer link (~95% net, $89/yr carrot) captured now while the window is $0; EU alternative terms (~7%); GERO/ADA discount strictly off-platform.** Decide how aggressively to push US users off-rail given the ~10-27% future-fee risk, and whether the $89/$99 web/IAP split is worth the friction.
3. **Native Swift vs React-Native.** The team has chosen native Swift (right for security/UX). The decision to ratify is the *consequence*: **maximize server-side logic in Nexus so each thin client is cheap to maintain** - accept zero client-code sharing in exchange for one canonical Guardrail.
4. **Centralize the router/Guardrail in Nexus?** Recommendation: **yes - one shared intent API, Guardrail re-resolution + verdict computation server-side, CBOR diff + signing client-side.** This is the single most important cross-platform decision; it is what keeps the Guardrail invariant (the moat) from forking. Confirm before either client builds a second swap/intent engine.

---

## Appendix A - Live API validation (2026-06-24)

Validated directly against the Fluxpoint production API with the corrected `GeroWallet` key (`key_id 6`, owner "Gero", active, no expiry). Empirical results, not docs.

**Billing model confirmed.** `/usage` shows `/token-analysis` billed at **0 tokens (flat)** while a `/chat` turn consumed 851 tokens - exactly the asymmetry the free Safety Verdict relies on. The deterministic risk layer is effectively free per call; only conversational LLM turns carry token cost.

**`/chat` (the brain).** Model is **`kimi-k2.6`** (provider `kimi`). Server-side **function-calling is real and confirmed**: a "what is the ADA price?" turn returned `used_tools: {calls:[{name:"get_ada_price"}]}` and the correct answer ($0.1472). The agent already ships **built-in Cardano market tools** - `get_ada_price`, `get_token_info` (price/changes/volume/mcap/liquidity/holders/verified/category), `get_top_gainers`/`losers`/`volume`/`mcap`, `get_market_stats`.
- *Implication:* a basic market chatbot works out-of-the-box with **zero Gero integration** - so the *commodity* market-Q&A layer is partly Fluxpoint's, and **Gero's moat must be wallet-specific context (your holdings, FIFO P&L) + the Guardrail + the action layer**, not generic market chat. This sharpens the positioning in section 4.
- *Integration lesson 1:* **set `max_tokens` generously (>=800).** Kimi's `reasoning` field consumes the budget; a low cap (120) returned an **empty reply** that graceful-degraded to an apology (HTTP 200 - the documented behavior). Generous budget + streaming avoids it.
- *Integration lesson 2:* **latency ~5.8s per non-streamed turn** (consistent across calls) - confirms the strategy's calls for streaming UX, the on-device-narrator fallback (14.4), and never blocking the wallet on the agent.

**`/token-analysis` V2 (the Safety Verdict data source).** Production-grade and richer than the docs. SNEK returned `risk_level: "low"` (overall 0.28) with subscores (market / liquidity / concentration / security / data_quality; sentiment + compliance unavailable), confidence 0.64, plus real market data (mcap $23.2M, vol24h $70.7k, 7d -21%, 30d -36%), liquidity (pool depth $1.11M across 20 pools), holders (41,550; top-10 hold 20.2%), security (`contract_verified: true`, `audit_status: "third_party"`), and a `t_mode` ML prediction layer (direction FLAT; `model_available: false` -> heuristics). Sources: BendingAIProvider, GeckoTerminalProvider, CardanoSecurityProvider. **It returns exactly the fields the free Safety Verdict needs**, flat-billed, in ~3s (latency dominated by a sentiment-source timeout at 3s - Gero should set a tighter per-source timeout or use the cache).

**Net effect on the strategy:** the two load-bearing assumptions hold (flat-billed risk layer; non-custodial propose-then-sign with Gero-side orchestration), the free Safety Verdict's data source is real and rich, and the only adjustments are integration-level (generous `max_tokens`, streaming, tighter risk-source timeouts) plus the positioning sharpening above.