// src/stores/agentAllowanceStore.ts
import Vue from 'vue';
import { recordSpend as ledgerRecordSpend } from '@/services/agent/allowanceLedger';
import type { AllowanceConfig, AllowanceStatus, SpendRecord } from '@/services/agent/allowancePolicy';

const STORE_KEY = 'agentAllowanceStore';
const MAX_LEDGER = 100;

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface AllowanceState {
  config: AllowanceConfig | null;
  ledger: SpendRecord[];
}

// ---------------------------------------------------------------------------
// Serialization helpers (bigint <-> string for chrome.storage)
//
// AllowanceConfig has three bigint fields:
//   totalBudgetLovelace, perPaymentCapLovelace, dailyCapLovelace
// SpendRecord has one bigint field:
//   amountLovelace
//
// On WRITE  : convert bigint -> string  (via serializeState)
// On READ   : convert string -> bigint  (via deserializeState)
// ---------------------------------------------------------------------------

interface SerializedConfig extends Omit<AllowanceConfig, 'totalBudgetLovelace' | 'perPaymentCapLovelace' | 'dailyCapLovelace'> {
  totalBudgetLovelace: string;
  perPaymentCapLovelace: string;
  dailyCapLovelace: string;
}

interface SerializedSpendRecord {
  ts: number;
  amountLovelace: string;
}

interface SerializedState {
  config: SerializedConfig | null;
  ledger: SerializedSpendRecord[];
}

export function serializeState(state: AllowanceState): SerializedState {
  const config: SerializedConfig | null = state.config
    ? {
        status: state.config.status,
        totalBudgetLovelace: state.config.totalBudgetLovelace.toString(),
        perPaymentCapLovelace: state.config.perPaymentCapLovelace.toString(),
        dailyCapLovelace: state.config.dailyCapLovelace.toString(),
        allowlistPayees: state.config.allowlistPayees,
        allowlistCategories: state.config.allowlistCategories,
        expiresAt: state.config.expiresAt,
      }
    : null;
  const ledger: SerializedSpendRecord[] = state.ledger.map((r) => ({
    ts: r.ts,
    amountLovelace: r.amountLovelace.toString(),
  }));
  return { config, ledger };
}

export function deserializeState(serialized: SerializedState): AllowanceState {
  const config: AllowanceConfig | null = serialized.config
    ? {
        status: serialized.config.status as AllowanceStatus,
        totalBudgetLovelace: BigInt(serialized.config.totalBudgetLovelace),
        perPaymentCapLovelace: BigInt(serialized.config.perPaymentCapLovelace),
        dailyCapLovelace: BigInt(serialized.config.dailyCapLovelace),
        allowlistPayees: serialized.config.allowlistPayees,
        allowlistCategories: serialized.config.allowlistCategories,
        expiresAt: serialized.config.expiresAt,
      }
    : null;
  const ledger: SpendRecord[] = serialized.ledger.map((r) => ({
    ts: r.ts,
    amountLovelace: BigInt(r.amountLovelace),
  }));
  return { config, ledger };
}

// ---------------------------------------------------------------------------
// Vue-observable store
// ---------------------------------------------------------------------------

export const agentAllowanceState = Vue.observable<AllowanceState>({ config: null, ledger: [] });

const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

if (hasChromeStorage) {
  chrome.storage.local.get(STORE_KEY, (res) => {
    const saved = res[STORE_KEY] as SerializedState | undefined;
    if (saved) {
      const hydrated = deserializeState(saved);
      agentAllowanceState.config = hydrated.config;
      agentAllowanceState.ledger = hydrated.ledger;
    }
  });
}

function persist(): void {
  if (!hasChromeStorage) return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const serialized = serializeState({ config: agentAllowanceState.config, ledger: agentAllowanceState.ledger });
    chrome.storage.local.set({ [STORE_KEY]: serialized });
  }, 300);
}

// ---------------------------------------------------------------------------
// Store methods
// ---------------------------------------------------------------------------

export const agentAllowanceStore = {
  state: agentAllowanceState,

  get config(): AllowanceConfig | null { return agentAllowanceState.config; },
  get ledger(): SpendRecord[] { return agentAllowanceState.ledger; },

  setConfig(cfg: AllowanceConfig): void {
    agentAllowanceState.config = cfg;
    persist();
  },

  /** Escalation - only a user action may raise limits. */
  patchConfig(partial: Partial<AllowanceConfig>): void {
    if (!agentAllowanceState.config) return;
    agentAllowanceState.config = { ...agentAllowanceState.config, ...partial };
    persist();
  },

  pause(): void {
    if (!agentAllowanceState.config) return;
    agentAllowanceState.config = { ...agentAllowanceState.config, status: 'paused' };
    persist();
  },

  resume(): void {
    if (!agentAllowanceState.config) return;
    agentAllowanceState.config = { ...agentAllowanceState.config, status: 'active' };
    persist();
  },

  revoke(): void {
    if (!agentAllowanceState.config) return;
    agentAllowanceState.config = { ...agentAllowanceState.config, status: 'revoked' };
    persist();
  },

  recordSpend(record: SpendRecord): void {
    agentAllowanceState.ledger = ledgerRecordSpend(agentAllowanceState.ledger, record, MAX_LEDGER);
    persist();
  },

  clear(): void {
    agentAllowanceState.config = null;
    agentAllowanceState.ledger = [];
    persist();
  },
};
