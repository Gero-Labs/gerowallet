<!-- src/sidepanel/components/agent/AllowanceCard.vue -->
<template>
  <div class="allowance-card">
    <!-- Gated-execution banner (always visible) -->
    <div class="allowance-card__banner">
      {{ $t('copilot.allowance.gatedNotice') }}
    </div>

    <!-- Setup form: no allowance configured yet -->
    <template v-if="!config">
      <div class="allowance-card__title">{{ $t('copilot.allowance.setup') }}</div>

      <div class="allowance-card__field">
        <label class="allowance-card__label">{{ $t('copilot.allowance.totalBudget') }}</label>
        <input
          v-model="form.totalBudget"
          class="allowance-card__input"
          type="number"
          min="0"
          step="0.000001"
          :placeholder="$t('copilot.allowance.totalBudget')"
        />
      </div>

      <div class="allowance-card__field">
        <label class="allowance-card__label">{{ $t('copilot.allowance.perPayment') }}</label>
        <input
          v-model="form.perPayment"
          class="allowance-card__input"
          type="number"
          min="0"
          step="0.000001"
          :placeholder="$t('copilot.allowance.perPayment')"
        />
      </div>

      <div class="allowance-card__field">
        <label class="allowance-card__label">{{ $t('copilot.allowance.dailyCap') }}</label>
        <input
          v-model="form.dailyCap"
          class="allowance-card__input"
          type="number"
          min="0"
          step="0.000001"
          :placeholder="$t('copilot.allowance.dailyCap')"
        />
      </div>

      <div class="allowance-card__field">
        <label class="allowance-card__label">{{ $t('copilot.allowance.expiry') }}</label>
        <input
          v-model="form.expiryDays"
          class="allowance-card__input"
          type="number"
          min="1"
          step="1"
          :placeholder="$t('copilot.allowance.expiry')"
        />
      </div>

      <div class="allowance-card__field">
        <label class="allowance-card__label">{{ $t('copilot.allowance.allowlist') }}</label>
        <input
          v-model="form.allowlist"
          class="allowance-card__input"
          type="text"
          :placeholder="$t('copilot.allowance.allowlist')"
        />
      </div>

      <div v-if="formErrors.length" class="allowance-card__errors">
        <ul class="allowance-card__error-list">
          <li v-for="(err, i) in formErrors" :key="i">{{ err }}</li>
        </ul>
      </div>

      <button class="allowance-card__btn" @click="onCreate()">
        {{ $t('copilot.allowance.create') }}
      </button>
    </template>

    <!-- Status view: allowance is configured -->
    <template v-else>
      <div class="allowance-card__title">{{ $t('copilot.allowance.title') }}</div>

      <!-- Status badge -->
      <div class="allowance-card__row">
        <span class="allowance-card__label-col">{{ $t('copilot.allowance.status') }}</span>
        <span :class="['allowance-card__badge', 'allowance-card__badge--' + config.status]">
          {{ $t('copilot.allowance.' + config.status) }}
        </span>
      </div>

      <!-- Total budget remaining -->
      <div class="allowance-card__row">
        <span class="allowance-card__label-col">{{ $t('copilot.allowance.totalBudget') }}</span>
        <span class="allowance-card__value-col">
          {{ formatLovelace(remaining.total) }} / {{ formatLovelace(config.totalBudgetLovelace) }} ADA {{ $t('copilot.allowance.remaining') }}
        </span>
      </div>

      <!-- Daily cap remaining -->
      <div class="allowance-card__row">
        <span class="allowance-card__label-col">{{ $t('copilot.allowance.dailyCap') }}</span>
        <span class="allowance-card__value-col">
          {{ formatLovelace(remaining.today) }} / {{ formatLovelace(config.dailyCapLovelace) }} ADA {{ $t('copilot.allowance.remaining') }}
        </span>
      </div>

      <!-- Per-payment cap -->
      <div class="allowance-card__row">
        <span class="allowance-card__label-col">{{ $t('copilot.allowance.perPayment') }}</span>
        <span class="allowance-card__value-col">{{ formatLovelace(config.perPaymentCapLovelace) }} ADA</span>
      </div>

      <!-- Expiry -->
      <div class="allowance-card__row">
        <span class="allowance-card__label-col">{{ $t('copilot.allowance.expiry') }}</span>
        <span class="allowance-card__value-col">{{ expiryDisplay }}</span>
      </div>

      <!-- Allowlist -->
      <div class="allowance-card__row">
        <span class="allowance-card__label-col">{{ $t('copilot.allowance.allowlist') }}</span>
        <span class="allowance-card__value-col allowance-card__allowlist">{{ allowlistDisplay }}</span>
      </div>

      <!-- Controls -->
      <div class="allowance-card__controls">
        <button
          v-if="config.status === 'active'"
          class="allowance-card__ctrl-btn allowance-card__ctrl-btn--warn"
          @click="onPause()"
        >
          {{ $t('copilot.allowance.pause') }}
        </button>
        <button
          v-if="config.status === 'paused'"
          class="allowance-card__ctrl-btn allowance-card__ctrl-btn--ok"
          @click="onResume()"
        >
          {{ $t('copilot.allowance.resume') }}
        </button>
        <button
          v-if="config.status !== 'revoked'"
          class="allowance-card__ctrl-btn allowance-card__ctrl-btn--danger"
          @click="onRevoke()"
        >
          {{ $t('copilot.allowance.revoke') }}
        </button>
        <button
          class="allowance-card__ctrl-btn"
          @click="showAdjust = !showAdjust"
        >
          {{ $t('copilot.allowance.adjust') }}
        </button>
      </div>

      <!-- Adjust limits inline form -->
      <div v-if="showAdjust" class="allowance-card__adjust">
        <div class="allowance-card__field">
          <label class="allowance-card__label">{{ $t('copilot.allowance.totalBudget') }}</label>
          <input
            v-model="adjustForm.totalBudget"
            class="allowance-card__input"
            type="number"
            min="0"
            step="0.000001"
          />
        </div>
        <div class="allowance-card__field">
          <label class="allowance-card__label">{{ $t('copilot.allowance.perPayment') }}</label>
          <input
            v-model="adjustForm.perPayment"
            class="allowance-card__input"
            type="number"
            min="0"
            step="0.000001"
          />
        </div>
        <div class="allowance-card__field">
          <label class="allowance-card__label">{{ $t('copilot.allowance.dailyCap') }}</label>
          <input
            v-model="adjustForm.dailyCap"
            class="allowance-card__input"
            type="number"
            min="0"
            step="0.000001"
          />
        </div>
        <div v-if="adjustErrors.length" class="allowance-card__errors">
          <ul class="allowance-card__error-list">
            <li v-for="(err, i) in adjustErrors" :key="i">{{ err }}</li>
          </ul>
        </div>
        <button class="allowance-card__btn" @click="onAdjust()">
          {{ $t('copilot.allowance.adjust') }}
        </button>
      </div>

      <!-- Receipts -->
      <div v-if="receipts.length" class="allowance-card__receipts">
        <div class="allowance-card__receipts-title">{{ $t('copilot.allowance.receipts') }}</div>
        <div
          v-for="(r, i) in receipts"
          :key="i"
          class="allowance-card__receipt"
        >
          <span class="allowance-card__receipt-amount">{{ formatLovelace(r.amountLovelace) }} ADA</span>
          <span class="allowance-card__receipt-time">{{ formatTs(r.ts) }}</span>
        </div>
      </div>
    </template>

    <p class="allowance-card__advice">{{ $t('copilot.allowance.notAdvice') }}</p>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue';
import { agentAllowance } from '@/sidepanel/composables/useAgentAllowance';
import type { AllowanceConfig, SpendRecord } from '@/services/agent/allowancePolicy';
import { copilotFeedStore } from '@/stores/copilotFeedStore';
import type { FeedItem } from '@/services/copilot/feedReducer';

/**
 * Appends a receipt line to the copilot Feed after `requestPayment` records a spend.
 *
 * GATED: Autonomous payment execution is not yet enabled. This helper is wired here
 * so it can be called by the autonomous execution path when that infra lands. It MUST
 * be called from the code path that calls `agentAllowance.requestPayment()` after an
 * `allowed` verdict is returned -- do NOT call it to fake a spend.
 *
 * @param amountLovelace - the actual spend amount in lovelace
 * @param payee - the payment recipient identifier
 */
export function recordAllowanceReceipt(amountLovelace: bigint, payee: string): void {
  const ts = Date.now();
  const ada = (Number(amountLovelace) / 1_000_000).toFixed(6);
  const item: FeedItem = {
    id: `allowance-receipt-${ts}`,
    key: `allowance-receipt:${ts}`,
    ts,
    textKey: 'copilot.allowance.receipt',
    params: { amount: ada, payee },
  };
  copilotFeedStore.merge([item]);
}

function lovelaceToAda(lovelace: bigint | null): string {
  if (lovelace === null) return '0';
  return (Number(lovelace) / 1_000_000).toFixed(6);
}

function adaToLovelace(ada: string): bigint {
  const n = parseFloat(ada);
  if (isNaN(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 1_000_000));
}

function parseAllowlist(raw: string): { payees: string[]; categories: string[] } {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Convention: category entries start with '#', everything else is a payee.
  // For simplicity all entries go into categories (user labels categories/payees as free text).
  // This keeps the UI simple; the policy engine checks both lists.
  return { payees: [], categories: items };
}

export default defineComponent({
  name: 'AllowanceCard',

  setup() {
    const allowance = agentAllowance;

    // -----------------------------------------------------------------------
    // Setup form state
    // -----------------------------------------------------------------------
    const form = ref({
      totalBudget: '',
      perPayment: '',
      dailyCap: '',
      expiryDays: '30',
      allowlist: '',
    });
    const formErrors = ref<string[]>([]);

    function onCreate(): void {
      formErrors.value = [];
      const totalBudgetLovelace = adaToLovelace(form.value.totalBudget);
      const perPaymentCapLovelace = adaToLovelace(form.value.perPayment);
      const dailyCapLovelace = adaToLovelace(form.value.dailyCap);
      const days = parseInt(form.value.expiryDays, 10);
      const expiresAt = Date.now() + (isNaN(days) || days < 1 ? 30 : days) * 86_400_000;
      const { payees, categories } = parseAllowlist(form.value.allowlist);

      const result = allowance.createAllowance({
        totalBudgetLovelace,
        perPaymentCapLovelace,
        dailyCapLovelace,
        allowlistPayees: payees,
        allowlistCategories: categories,
        expiresAt,
      });

      if (!result.ok) {
        formErrors.value = result.errors;
      }
    }

    // -----------------------------------------------------------------------
    // Adjust form state
    // -----------------------------------------------------------------------
    const showAdjust = ref(false);
    const adjustForm = ref({ totalBudget: '', perPayment: '', dailyCap: '' });
    const adjustErrors = ref<string[]>([]);

    function onAdjust(): void {
      adjustErrors.value = [];
      const patch: Partial<AllowanceConfig> = {};
      if (adjustForm.value.totalBudget) {
        patch.totalBudgetLovelace = adaToLovelace(adjustForm.value.totalBudget);
        if (patch.totalBudgetLovelace <= 0n) {
          adjustErrors.value.push('Total budget must be greater than zero.');
          return;
        }
      }
      if (adjustForm.value.perPayment) {
        patch.perPaymentCapLovelace = adaToLovelace(adjustForm.value.perPayment);
        if (patch.perPaymentCapLovelace <= 0n) {
          adjustErrors.value.push('Per-payment cap must be greater than zero.');
          return;
        }
      }
      if (adjustForm.value.dailyCap) {
        patch.dailyCapLovelace = adaToLovelace(adjustForm.value.dailyCap);
        if (patch.dailyCapLovelace <= 0n) {
          adjustErrors.value.push('Daily cap must be greater than zero.');
          return;
        }
      }
      allowance.updateLimits(patch);
      showAdjust.value = false;
      adjustForm.value = { totalBudget: '', perPayment: '', dailyCap: '' };
    }

    // -----------------------------------------------------------------------
    // Control actions
    // -----------------------------------------------------------------------
    function onPause(): void {
      allowance.pause();
    }

    function onResume(): void {
      allowance.resume();
    }

    function onRevoke(): void {
      allowance.revoke();
    }

    // -----------------------------------------------------------------------
    // Computed display values
    // -----------------------------------------------------------------------
    const config = computed((): AllowanceConfig | null => allowance.config.value);
    const remaining = computed(() => allowance.remaining.value);
    const receipts = computed((): SpendRecord[] => allowance.receipts.value);

    const expiryDisplay = computed((): string => {
      const cfg = config.value;
      if (!cfg) return '';
      return new Date(cfg.expiresAt).toLocaleDateString();
    });

    const allowlistDisplay = computed((): string => {
      const cfg = config.value;
      if (!cfg) return '';
      const all = [...cfg.allowlistPayees, ...cfg.allowlistCategories];
      return all.join(', ') || '-';
    });

    function formatLovelace(lovelace: bigint | null | undefined): string {
      if (lovelace === null || lovelace === undefined) return '0.000000';
      return lovelaceToAda(lovelace);
    }

    function formatTs(ts: number): string {
      return new Date(ts).toLocaleString();
    }

    return {
      config,
      remaining,
      receipts,
      form,
      formErrors,
      onCreate,
      showAdjust,
      adjustForm,
      adjustErrors,
      onAdjust,
      onPause,
      onResume,
      onRevoke,
      expiryDisplay,
      allowlistDisplay,
      formatLovelace,
      formatTs,
    };
  },
});
</script>

<style scoped>
.allowance-card {
  border-radius: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 13px;
}

.allowance-card__banner {
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(91, 108, 255, 0.15);
  border: 1px solid rgba(91, 108, 255, 0.4);
  font-size: 11px;
  line-height: 1.4;
  margin-bottom: 10px;
  opacity: 0.9;
}

.allowance-card__title {
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 8px;
}

.allowance-card__field {
  margin-bottom: 8px;
}

.allowance-card__label {
  display: block;
  font-size: 11px;
  opacity: 0.65;
  margin-bottom: 3px;
}

.allowance-card__input {
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  padding: 6px 8px;
  font-size: 13px;
}

.allowance-card__errors {
  margin-bottom: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(249, 112, 102, 0.12);
  border: 1px solid rgba(249, 112, 102, 0.35);
}

.allowance-card__error-list {
  margin: 0;
  padding-left: 16px;
  color: #f97066;
  font-size: 11px;
}

.allowance-card__btn {
  margin-top: 6px;
  width: 100%;
  padding: 8px;
  border-radius: 10px;
  border: none;
  background: var(--v-primary-base, #5b6cff);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  font-size: 13px;
  transition: opacity 0.15s;
}

.allowance-card__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  gap: 6px;
}

.allowance-card__label-col {
  opacity: 0.65;
  flex-shrink: 0;
}

.allowance-card__value-col {
  font-weight: 600;
  text-align: right;
  font-size: 12px;
}

.allowance-card__allowlist {
  font-size: 11px;
  word-break: break-word;
  text-align: right;
  max-width: 60%;
}

.allowance-card__badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
}

.allowance-card__badge--active {
  background: rgba(71, 205, 137, 0.18);
  color: #47cd89;
}

.allowance-card__badge--paused {
  background: rgba(255, 183, 77, 0.18);
  color: #ffb74d;
}

.allowance-card__badge--revoked {
  background: rgba(249, 112, 102, 0.18);
  color: #f97066;
}

.allowance-card__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.allowance-card__ctrl-btn {
  flex: 1;
  min-width: 70px;
  padding: 6px 10px;
  border-radius: 8px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.allowance-card__ctrl-btn--warn {
  background: rgba(255, 183, 77, 0.2);
  color: #ffb74d;
}

.allowance-card__ctrl-btn--ok {
  background: rgba(71, 205, 137, 0.2);
  color: #47cd89;
}

.allowance-card__ctrl-btn--danger {
  background: rgba(249, 112, 102, 0.2);
  color: #f97066;
}

.allowance-card__adjust {
  margin-top: 10px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.allowance-card__receipts {
  margin-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 8px;
}

.allowance-card__receipts-title {
  font-size: 11px;
  font-weight: 700;
  opacity: 0.65;
  margin-bottom: 6px;
}

.allowance-card__receipt {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
  font-size: 11px;
}

.allowance-card__receipt-amount {
  font-weight: 600;
}

.allowance-card__receipt-time {
  opacity: 0.55;
}

.allowance-card__advice {
  margin: 8px 0 0;
  font-size: 10px;
  opacity: 0.45;
}
</style>
