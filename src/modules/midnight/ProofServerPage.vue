<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12">
        <div class="proof-server-page">
          <!-- Header -->
          <div class="ps-header">
            <div class="ps-header-icon">
              <v-icon size="26" color="var(--g-accent)">mdi-server-security</v-icon>
            </div>
            <div>
              <h1 class="t-display">{{ t('midnight.proofServerPage.title') }}</h1>
              <p class="t-body-lg ps-subtitle">{{ t('midnight.proofServerPage.subtitle') }}</p>
            </div>
          </div>

          <!-- Non-Midnight wallet: nothing to configure here -->
          <div v-if="!isMidnight" class="ps-card ps-empty-state">
            <v-icon size="32" color="var(--g-text-3)">mdi-server-off</v-icon>
            <h2 class="t-heading mt-3">{{ t('midnight.proofServerPage.notMidnightTitle') }}</h2>
            <p class="t-body ps-empty-body">{{ t('midnight.proofServerPage.notMidnightBody') }}</p>
          </div>

          <template v-else>
            <!-- Mode selection. Short compare titles (not the long
                 "(default)" labels) so three cards fit one row; the hint
                 line under each carries the differentiation. -->
            <div class="ps-mode-grid">
              <button
                type="button"
                class="ps-mode-card"
                :class="{ 'ps-mode-card--active': proofServerMode === 'remote' }"
                :disabled="proofServerSaving"
                @click="proofServerMode = 'remote'"
              >
                <div class="ps-mode-icon"><v-icon size="22">mdi-cloud-outline</v-icon></div>
                <div class="ps-mode-body">
                  <div class="ps-mode-title-row">
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.compareRemoteTitle') }}</span>
                    <span v-if="proofServerMode === 'remote'" class="ps-active-badge">
                      <v-icon size="12">mdi-check</v-icon>{{ t('midnight.proofServerPage.activeBadge') }}
                    </span>
                  </div>
                  <p class="t-caption ps-mode-hint">{{ t('midnight.proofServerPage.remoteCardBody') }}</p>
                </div>
              </button>

              <button
                type="button"
                class="ps-mode-card"
                :class="{ 'ps-mode-card--active': proofServerMode === 'zkpaas' }"
                :disabled="proofServerSaving"
                @click="proofServerMode = 'zkpaas'"
              >
                <div class="ps-mode-icon"><v-icon size="22">mdi-google-cloud</v-icon></div>
                <div class="ps-mode-body">
                  <div class="ps-mode-title-row">
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.compareZkpaasTitle') }}</span>
                    <span v-if="proofServerMode === 'zkpaas'" class="ps-active-badge">
                      <v-icon size="12">mdi-check</v-icon>{{ t('midnight.proofServerPage.activeBadge') }}
                    </span>
                  </div>
                  <p class="t-caption ps-mode-hint">{{ t('midnight.proofServerPage.zkpaasCardBody') }}</p>
                </div>
              </button>

              <button
                type="button"
                class="ps-mode-card"
                :class="{ 'ps-mode-card--active': proofServerMode === 'local' }"
                :disabled="proofServerSaving"
                @click="proofServerMode = 'local'"
              >
                <div class="ps-mode-icon"><v-icon size="22">mdi-laptop</v-icon></div>
                <div class="ps-mode-body">
                  <div class="ps-mode-title-row">
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.compareLocalTitle') }}</span>
                    <span v-if="proofServerMode === 'local'" class="ps-active-badge">
                      <v-icon size="12">mdi-check</v-icon>{{ t('midnight.proofServerPage.activeBadge') }}
                    </span>
                  </div>
                  <p class="t-caption ps-mode-hint">{{ t('midnight.proofServerPage.localCardBody') }}</p>
                </div>
              </button>
            </div>

            <!-- Local setup guide -->
            <div v-if="proofServerMode === 'local'" class="ps-card">
              <h2 class="t-heading mb-3">{{ t('midnight.proofServerPage.setupTitle') }}</h2>

              <div class="ps-step">
                <div class="ps-step-badge">1</div>
                <div class="ps-step-body">
                  <div class="ps-step-title-row">
                    <v-icon size="16" color="var(--g-text-2)">mdi-docker</v-icon>
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.step1Title') }}</span>
                  </div>
                  <p class="t-body-sm ps-step-hint">{{ t('midnight.proofServerPage.step1Body') }}</p>
                  <a
                    class="ps-step-link"
                    href="https://www.docker.com/products/docker-desktop/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ t('midnight.proofServerPage.step1Link') }}
                    <v-icon size="13">mdi-open-in-new</v-icon>
                  </a>
                </div>
              </div>

              <div class="ps-step">
                <div class="ps-step-badge">2</div>
                <div class="ps-step-body">
                  <div class="ps-step-title-row">
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.step2Title') }}</span>
                  </div>
                  <div class="proof-server-command-row">
                    <code class="proof-server-command g-mono">{{ dockerRunCommand }}</code>
                    <CopyButton :value="dockerRunCommand" small />
                  </div>
                  <p class="t-caption ps-step-hint">{{ t('midnight.proofServer.firstRunNote') }}</p>
                </div>
              </div>

              <div class="ps-step ps-step--last">
                <div class="ps-step-badge">3</div>
                <div class="ps-step-body">
                  <div class="ps-step-title-row">
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.step3Title') }}</span>
                  </div>
                  <p class="t-body-sm ps-step-hint">{{ t('midnight.proofServerPage.step3Body') }}</p>

                  <div class="proof-server-status-row">
                    <div class="status-pill t-caption" :class="`status-pill--${healthStatus}`">
                      <v-progress-circular
                        v-if="healthStatus === 'checking'"
                        indeterminate
                        size="12"
                        width="2"
                        color="var(--g-text-3)"
                      />
                      <span v-else class="status-dot" :class="`status-dot--${healthStatus}`"></span>
                      <span class="status-pill-label">{{ healthStatusLabel }}</span>
                    </div>
                    <GButton tier="secondary" compact :loading="testingConnection" @click="testConnection">
                      {{ t('midnight.proofServer.testConnection') }}
                    </GButton>
                  </div>
                  <p v-if="lastCheckedAt" class="t-caption ps-check-detail">
                    {{ t('midnight.proofServerPage.checkedAgo', { time: formatRelativeTime(lastCheckedAt) }) }}
                    <template v-if="lastCheckLatencyMs !== null">
                      · {{ t('midnight.proofServerPage.latencyMs', { ms: lastCheckLatencyMs }) }}
                    </template>
                  </p>
                </div>
              </div>

              <v-expansion-panels flat class="ps-advanced">
                <v-expansion-panel>
                  <v-expansion-panel-header class="t-caption ps-advanced-header">
                    {{ t('midnight.proofServerPage.advancedUrl') }}
                  </v-expansion-panel-header>
                  <v-expansion-panel-content>
                    <v-text-field
                      v-model="localUrlDraft"
                      :label="t('midnight.proofServer.urlLabel')"
                      outlined
                      dense
                      hide-details="auto"
                      class="mt-2 proof-server-url-field"
                      :error-messages="localUrlError ? [localUrlError] : []"
                      :disabled="proofServerSaving"
                      @blur="onLocalUrlBlur"
                    />
                  </v-expansion-panel-content>
                </v-expansion-panel>
              </v-expansion-panels>
            </div>

            <!-- Arkhia zkPaaS setup guide: same stepped structure as the
                 local guide so the two setup flows read as one family. -->
            <div v-if="proofServerMode === 'zkpaas'" class="ps-card">
              <h2 class="t-heading mb-3">{{ t('midnight.proofServerPage.zkpaasSetupTitle') }}</h2>

              <div class="ps-step">
                <div class="ps-step-badge">1</div>
                <div class="ps-step-body">
                  <div class="ps-step-title-row">
                    <v-icon size="16" color="var(--g-text-2)">mdi-account-key-outline</v-icon>
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.zkpaasStep1Title') }}</span>
                  </div>
                  <p class="t-body-sm ps-step-hint">{{ t('midnight.proofServerPage.zkpaasStep1Body') }}</p>
                  <a
                    class="ps-step-link"
                    :href="arkhiaDashboardUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ t('midnight.proofServerPage.zkpaasStep1Link') }}
                    <v-icon size="13">mdi-open-in-new</v-icon>
                  </a>
                </div>
              </div>

              <div class="ps-step">
                <div class="ps-step-badge">2</div>
                <div class="ps-step-body">
                  <div class="ps-step-title-row">
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.zkpaasStep2Title') }}</span>
                  </div>
                  <!-- Credentials persist on blur, like the local URL field.
                       Password inputs with a reveal toggle: these are paid
                       API credentials, not display text. -->
                  <v-text-field
                    v-model="zkpaasKeyDraft"
                    :label="t('midnight.proofServerPage.zkpaasKeyLabel')"
                    :type="showZkpaasKey ? 'text' : 'password'"
                    :append-icon="showZkpaasKey ? 'mdi-eye-off' : 'mdi-eye'"
                    autocomplete="off"
                    outlined
                    dense
                    hide-details="auto"
                    class="mt-2 proof-server-url-field"
                    :disabled="proofServerSaving"
                    @click:append="showZkpaasKey = !showZkpaasKey"
                    @blur="onZkpaasKeyBlur"
                  />
                  <v-text-field
                    v-model="zkpaasSecretDraft"
                    :label="t('midnight.proofServerPage.zkpaasSecretLabel')"
                    :type="showZkpaasSecret ? 'text' : 'password'"
                    :append-icon="showZkpaasSecret ? 'mdi-eye-off' : 'mdi-eye'"
                    autocomplete="off"
                    outlined
                    dense
                    hide-details="auto"
                    class="mt-3 proof-server-url-field"
                    :disabled="proofServerSaving"
                    @click:append="showZkpaasSecret = !showZkpaasSecret"
                    @blur="onZkpaasSecretBlur"
                  />
                </div>
              </div>

              <div class="ps-step ps-step--last">
                <div class="ps-step-badge">3</div>
                <div class="ps-step-body">
                  <div class="ps-step-title-row">
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.step3Title') }}</span>
                  </div>
                  <p class="t-body-sm ps-step-hint">{{ t('midnight.proofServerPage.zkpaasStep3Body') }}</p>

                  <div class="proof-server-status-row">
                    <div class="status-pill t-caption" :class="`status-pill--${healthStatus}`">
                      <v-progress-circular
                        v-if="healthStatus === 'checking'"
                        indeterminate
                        size="12"
                        width="2"
                        color="var(--g-text-3)"
                      />
                      <span v-else class="status-dot" :class="`status-dot--${healthStatus}`"></span>
                      <span class="status-pill-label">{{ healthStatusLabel }}</span>
                    </div>
                    <GButton
                      tier="secondary"
                      compact
                      :loading="testingConnection"
                      :disabled="!zkpaasConfigured"
                      @click="testConnection()"
                    >
                      {{ t('midnight.proofServer.testConnection') }}
                    </GButton>
                  </div>
                  <p v-if="lastCheckedAt" class="t-caption ps-check-detail">
                    {{ t('midnight.proofServerPage.checkedAgo', { time: formatRelativeTime(lastCheckedAt) }) }}
                    <template v-if="lastCheckLatencyMs !== null">
                      · {{ t('midnight.proofServerPage.latencyMs', { ms: lastCheckLatencyMs }) }}
                    </template>
                  </p>
                </div>
              </div>

              <v-expansion-panels flat class="ps-advanced">
                <v-expansion-panel>
                  <v-expansion-panel-header class="t-caption ps-advanced-header">
                    {{ t('midnight.proofServerPage.advancedUrl') }}
                  </v-expansion-panel-header>
                  <v-expansion-panel-content>
                    <!-- Empty = automatic: the per-network Arkhia endpoint
                         shows as the placeholder so "automatic" is a
                         visible URL, not a mystery. -->
                    <v-text-field
                      v-model="zkpaasUrlDraft"
                      :label="t('midnight.proofServer.urlLabel')"
                      :placeholder="zkpaasEffectiveUrl"
                      persistent-placeholder
                      outlined
                      dense
                      hide-details="auto"
                      class="mt-2 proof-server-url-field"
                      :error-messages="zkpaasUrlError ? [zkpaasUrlError] : []"
                      :disabled="proofServerSaving"
                      @blur="onZkpaasUrlBlur"
                    />
                  </v-expansion-panel-content>
                </v-expansion-panel>
              </v-expansion-panels>
            </div>

            <!-- Recent proving activity: only wallet-side proving (local or
                 zkPaaS) is instrumented (remote/cloud proving runs entirely
                 inside the Nexus sidecar, invisible to the wallet) - see
                 midnightStore.ts MidnightProvingLogEntry. Its OWN card,
                 visible whenever there IS history regardless of current
                 mode - it is a record of what already happened, not a
                 mode-specific status (unlike the setup guides above). -->
            <div v-if="provingHistory.length > 0" class="ps-card">
              <h2 class="t-heading mb-2">{{ t('midnight.proofServerPage.recentActivityTitle') }}</h2>
              <div v-for="(entry, i) in provingHistory" :key="i" class="ps-proving-entry">
                <v-icon
                  size="16"
                  :color="entry.success ? 'var(--g-success)' : 'var(--g-error)'"
                >{{ entry.success ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline' }}</v-icon>
                <div class="ps-proving-entry-body">
                  <div class="t-body-sm">
                    {{ entry.success
                      ? t('midnight.proofServerPage.provedIn', { seconds: (entry.durationMs / 1000).toFixed(1) })
                      : t('midnight.proofServerPage.provingFailed') }}
                  </div>
                  <p v-if="!entry.success && entry.error" class="t-caption ps-proving-error">{{ entry.error }}</p>
                </div>
                <span class="t-caption ps-proving-time">{{ formatRelativeTime(entry.timestamp) }}</span>
              </div>
            </div>

            <!-- How it works -->
            <div class="ps-card">
              <h2 class="t-heading mb-2">{{ t('midnight.proofServerPage.howItWorksTitle') }}</h2>
              <p class="t-body ps-how-body">{{ t('midnight.proofServerPage.howItWorksBody') }}</p>

              <div class="ps-compare-grid">
                <div class="ps-compare-item">
                  <div class="ps-compare-header">
                    <v-icon size="16" color="var(--g-text-3)">mdi-cloud-outline</v-icon>
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.compareRemoteTitle') }}</span>
                  </div>
                  <p class="t-caption">{{ t('midnight.proofServerPage.compareRemoteBody') }}</p>
                </div>
                <div class="ps-compare-item">
                  <div class="ps-compare-header">
                    <v-icon size="16" color="var(--g-text-3)">mdi-google-cloud</v-icon>
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.compareZkpaasTitle') }}</span>
                  </div>
                  <p class="t-caption">{{ t('midnight.proofServerPage.compareZkpaasBody') }}</p>
                </div>
                <div class="ps-compare-item">
                  <div class="ps-compare-header">
                    <v-icon size="16" color="var(--g-text-3)">mdi-laptop</v-icon>
                    <span class="t-body-lg">{{ t('midnight.proofServerPage.compareLocalTitle') }}</span>
                  </div>
                  <p class="t-caption">{{ t('midnight.proofServerPage.compareLocalBody') }}</p>
                </div>
              </div>
            </div>

            <!-- FAQ -->
            <div class="ps-card">
              <h2 class="t-heading mb-2">{{ t('midnight.proofServerPage.faqTitle') }}</h2>
              <v-expansion-panels flat class="ps-panels">
                <v-expansion-panel v-for="faq in faqs" :key="faq.q">
                  <v-expansion-panel-header class="t-body-lg">{{ faq.q }}</v-expansion-panel-header>
                  <v-expansion-panel-content class="t-body">{{ faq.a }}</v-expansion-panel-content>
                </v-expansion-panel>
              </v-expansion-panels>
            </div>
          </template>
        </div>
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import { useMidnightProofServer, formatRelativeTime } from '@/chains/midnight/useProofServerSettings';
import CopyButton from '@/shared/components/CopyButton.vue';
import GButton from '@/shared/components/GButton/GButton.vue';

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const isMidnight = computed(() => loggedWallet.value?.chain === Blockchain.MIDNIGHT);

const {
  proofServerMode,
  proofServerSaving,
  localUrlDraft,
  localUrlError,
  onLocalUrlBlur,
  zkpaasUrlDraft,
  zkpaasUrlError,
  onZkpaasUrlBlur,
  zkpaasKeyDraft,
  onZkpaasKeyBlur,
  zkpaasSecretDraft,
  onZkpaasSecretBlur,
  zkpaasEffectiveUrl,
  zkpaasConfigured,
  arkhiaDashboardUrl,
  dockerRunCommand,
  healthStatus,
  healthStatusLabel,
  testingConnection,
  testConnection,
  lastCheckedAt,
  lastCheckLatencyMs,
  provingHistory,
} = useMidnightProofServer();

const showZkpaasKey = ref(false);
const showZkpaasSecret = ref(false);

const faqs = computed(() => ([
  { q: t('midnight.proofServerPage.faq1Q'), a: t('midnight.proofServerPage.faq1A') },
  { q: t('midnight.proofServerPage.faq2Q'), a: t('midnight.proofServerPage.faq2A') },
  { q: t('midnight.proofServerPage.faq5Q'), a: t('midnight.proofServerPage.faq5A') },
  { q: t('midnight.proofServerPage.faq3Q'), a: t('midnight.proofServerPage.faq3A') },
  { q: t('midnight.proofServerPage.faq4Q'), a: t('midnight.proofServerPage.faq4A') },
]));
</script>

<style scoped>
.proof-server-page {
  max-width: 760px;
  margin: 0 auto;
  padding: var(--g-s-6) var(--g-s-5) var(--g-s-6);
}

.ps-header {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-4);
  margin-bottom: var(--g-s-6);
}

.ps-header-icon {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: var(--g-r-card);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ps-subtitle {
  color: var(--g-text-2);
  margin-top: var(--g-s-1);
  margin-bottom: 0;
}

.ps-card {
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-sheet);
  padding: var(--g-s-5);
  margin-bottom: var(--g-s-4);
}

.ps-empty-state {
  text-align: center;
  padding: var(--g-s-6) var(--g-s-5);
}

.ps-empty-body {
  max-width: 380px;
  margin: 0 auto;
}

/* ── Mode cards ── */

.ps-mode-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--g-s-3);
  margin-bottom: var(--g-s-4);
}

@media (max-width: 620px) {
  .ps-mode-grid { grid-template-columns: 1fr; }
}

.ps-mode-card {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
  text-align: left;
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-sheet);
  padding: var(--g-s-4);
  cursor: pointer;
  transition: border-color var(--g-dur-fast) ease, background var(--g-dur-fast) ease;
  font: inherit;
  color: inherit;
}

.ps-mode-card:hover:not(:disabled) {
  border-color: var(--g-hairline-2);
}

.ps-mode-card:disabled {
  cursor: default;
  opacity: 0.7;
}

.ps-mode-card--active {
  border-color: var(--g-accent);
  background: var(--g-raised);
}

.ps-mode-icon {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--g-text-2);
}

.ps-mode-card--active .ps-mode-icon {
  color: var(--g-accent);
}

.ps-mode-body {
  flex: 1;
  min-width: 0;
}

.ps-mode-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.ps-mode-hint {
  margin-top: var(--g-s-1);
  margin-bottom: 0;
}

.ps-active-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--g-accent);
  border: 1px solid var(--g-accent);
  border-radius: var(--g-r-pill);
  padding: 2px 8px;
}

/* ── Setup steps ── */

.ps-step {
  display: flex;
  gap: var(--g-s-3);
  padding-bottom: var(--g-s-4);
  margin-bottom: var(--g-s-4);
  border-bottom: 1px solid var(--g-hairline-1);
}

.ps-step--last {
  border-bottom: none;
  margin-bottom: var(--g-s-2);
  padding-bottom: 0;
}

.ps-step-badge {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-2);
}

.ps-step-body {
  flex: 1;
  min-width: 0;
}

.ps-step-title-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.ps-step-hint {
  margin-top: var(--g-s-1);
  margin-bottom: 0;
}

.ps-step-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: var(--g-s-2);
  color: var(--g-accent);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.ps-step-link:hover {
  text-decoration: underline;
}

.proof-server-command-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  background: var(--g-canvas);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: var(--g-s-2) var(--g-s-3);
  margin-top: var(--g-s-2);
  overflow-x: auto;
}

.proof-server-command {
  color: var(--g-text-1);
  font-size: 12.5px;
  white-space: pre;
  flex: 1;
  min-width: 0;
}

.proof-server-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  margin-top: var(--g-s-3);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.status-dot--detected { background: var(--g-success); }
.status-dot--notDetected { background: var(--g-text-3); }
.status-dot--notConfigured { background: var(--g-text-3); }

.status-pill--detected .status-pill-label { color: var(--g-success); }

.ps-check-detail {
  margin-top: var(--g-s-2);
  margin-bottom: 0;
}

/* ── Recent proving activity ── */

.ps-proving-entry {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: var(--g-s-2) 0;
}

.ps-proving-entry:not(:last-child) {
  border-bottom: 1px solid var(--g-hairline-1);
}

.ps-proving-entry-body {
  flex: 1;
  min-width: 0;
}

.ps-proving-error {
  margin-top: 2px;
  margin-bottom: 0;
  word-break: break-word;
}

.ps-proving-time {
  flex: none;
  white-space: nowrap;
}

.ps-advanced {
  margin-top: var(--g-s-2);
}

/* :deep() reaches the inner v-expansion-panel, which is where Vuetify's
   unflagged `.v-expansion-panels .v-expansion-panel { background-color }`
   rule (0,2,0) actually paints - the outer v-expansion-panels element itself
   carries no background. Scoping keeps this specific to these two
   accordions. Two class selectors plus the scoped attribute (0,3,0) wins
   outright with no forced override flag needed (same technique as
   GButton.vue). */
.ps-advanced :deep(.v-expansion-panel),
.ps-panels :deep(.v-expansion-panel) {
  background: transparent;
}

.ps-panels :deep(.v-expansion-panel):not(:last-child) {
  border-bottom: 1px solid var(--g-hairline-1);
}

.ps-advanced-header {
  min-height: 36px;
  padding: 0;
  color: var(--g-text-2);
}

/* ── How it works / compare ── */

.ps-how-body {
  margin-bottom: var(--g-s-4);
}

/* Plain reference columns, not cards - these are read-only context, not a
   choice (the actual mode picker is the ps-mode-card pair above). A raised
   bordered box here would read as clickable when it isn't. */
.ps-compare-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--g-s-5);
}

@media (max-width: 620px) {
  .ps-compare-grid {
    grid-template-columns: 1fr;
    gap: var(--g-s-3);
  }
  .ps-compare-item:not(:first-child) {
    border-left: none;
    border-top: 1px solid var(--g-hairline-1);
    padding-left: 0;
    padding-top: var(--g-s-3);
  }
}

.ps-compare-item:not(:first-child) {
  border-left: 1px solid var(--g-hairline-1);
  padding-left: var(--g-s-5);
}

.ps-compare-header {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.ps-compare-item p {
  margin-top: var(--g-s-1);
  margin-bottom: 0;
}
</style>
