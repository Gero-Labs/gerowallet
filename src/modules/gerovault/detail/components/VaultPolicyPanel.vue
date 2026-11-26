<template>
  <div class="vault-policy">
    <section class="glass-panel vault-policy__card" data-test="vault-policy">
      <h2 class="t-heading">{{ $t('gerovault.detail.policy.title') }}</h2>
      <dl class="vault-policy__rows">
        <div class="vault-policy__row">
          <dt class="t-body-sm">{{ $t('gerovault.detail.policy.threshold') }}</dt>
          <dd class="t-body-lg g-num" data-test="vault-threshold">
            {{ $t('gerovault.detail.policy.thresholdValue', { threshold: facts.template.threshold, owners: facts.template.ownerCount }) }}
          </dd>
        </div>
        <div class="vault-policy__row">
          <dt class="t-body-sm">{{ $t('gerovault.detail.policy.template') }}</dt>
          <dd class="t-body-sm">{{ facts.template.kind === 'backup' ? $t('gerovault.detail.policy.templateBackup') : $t('gerovault.detail.policy.templateStandard') }}</dd>
        </div>
        <div v-if="facts.template.backup" class="vault-policy__row" data-test="vault-backup-terms">
          <dt class="t-body-sm">{{ $t('gerovault.detail.policy.backupPath') }}</dt>
          <dd class="t-body-sm">
            {{ $t('gerovault.detail.policy.backupValue', { threshold: facts.template.backup.threshold, holders: facts.template.backup.holderCount }) }}
            <span class="t-caption vault-policy__sub">
              {{ facts.template.backup.opensAtMs !== undefined
                ? $t('gerovault.detail.policy.backupOpens', { date: formatDate(facts.template.backup.opensAtMs) })
                : $t('gerovault.detail.policy.backupSlot', { slot: facts.template.backup.afterSlot }) }}
            </span>
          </dd>
        </div>
        <div class="vault-policy__row">
          <dt class="t-body-sm">{{ $t('gerovault.detail.policy.enforcement') }}</dt>
          <dd class="t-body-sm">{{ $t('gerovault.detail.policy.enforcementValue') }}</dd>
        </div>
        <div v-if="detailsVisible" class="vault-policy__row">
          <dt class="t-body-sm">{{ $t('gerovault.detail.policy.yourKey') }}</dt>
          <dd class="g-mono">{{ ownPath }}</dd>
        </div>
      </dl>
    </section>

    <section class="glass-panel vault-policy__card" data-test="vault-participants">
      <div class="vault-policy__head">
        <h2 class="t-heading">{{ $t('gerovault.detail.participants.title') }}</h2>
        <InfoTooltip :label="$t('gerovault.detail.participants.aboutLabel')" :text="$t('gerovault.detail.participants.about')" />
      </div>
      <ul class="vault-policy__people">
        <li v-for="(p, i) in facts.participants" :key="p.credential" class="vault-policy__person" data-test="vault-participant">
          <div class="vault-policy__who">
            <span class="t-body-lg">
              {{ p.label ? displayLabel(p.label) : $t(p.role === 'owner' ? 'gerovault.detail.participants.owner' : 'gerovault.detail.participants.backupHolder', { n: ordinal(i, p.role) }) }}
              <span v-if="p.self" class="t-caption">{{ $t('gerovault.detail.participants.you') }}</span>
            </span>
            <span class="t-caption">
              {{ p.role === 'owner' ? $t('gerovault.detail.participants.roleOwner') : $t('gerovault.detail.participants.roleBackup') }}
              <template v-if="p.label && claimsFromPackage"> {{ $t('gerovault.detail.recovery.claim') }}</template>
            </span>
            <span v-if="detailsVisible" class="t-caption vault-policy__credential">
              {{ $t('gerovault.detail.participants.keyHash') }} <ChunkedValue :value="p.credential" />
            </span>
          </div>
          <v-chip v-if="!p.self" size="small" variant="outlined" :color="toneOf(checkOf(p.credential)?.state)" data-test="vault-participant-check">
            {{ $t(labelOf(p.credential).key, { method: labelOf(p.credential).methodKey ? $t(labelOf(p.credential).methodKey as string) : '', date: labelOf(p.credential).date ?? '' }) }}
          </v-chip>
        </li>
      </ul>
      <p class="t-caption vault-policy__note">{{ $t('gerovault.detail.participants.checkNote') }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import InfoTooltip from '@/shared/components/InfoTooltip.vue';
import { displayLabel } from '@/shared/gerovault';
import type { VaultRecord } from '@/modules/gerovault/contracts';
import { ownKeyPath, type VaultFacts } from '@/modules/gerovault/detail/vaultFacts';
import type { CosignerCheck, CosignerCheckState } from '@/modules/gerovault/detail/verification';
import ChunkedValue from './ChunkedValue.vue';

defineOptions({ name: 'VaultPolicyPanel' });

const props = defineProps<{
  record: VaultRecord;
  facts: VaultFacts;
  checks: readonly CosignerCheck[];
  detailsVisible: boolean;
}>();

const ownPath = computed(() => ownKeyPath(props.record));
/** A restored vault's labels came from its recovery package: claims, never verified. */
const claimsFromPackage = computed(() => props.record.origin === 'restored');

function ordinal(index: number, role: string): number {
  return props.facts.participants.slice(0, index + 1).filter(p => p.role === role).length;
}

function checkOf(credential: string): CosignerCheck | undefined {
  return props.checks.find(c => c.credential === credential);
}

const METHOD_KEYS: Record<string, string> = {
  number: 'gerovault.detail.check.byNumber',
  qr: 'gerovault.detail.check.byQr',
  external: 'gerovault.detail.check.byFile',
  endorsed: 'gerovault.detail.check.byEndorsement',
  provider: 'gerovault.detail.check.byProvider',
};

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
function formatDate(ms: number): string {
  return dateFormatter.format(new Date(ms));
}

/** The chip's text as a key, with the method as a key of its own. */
function checkLabel(check: CosignerCheck | undefined): { key: string; methodKey?: string; date?: string } {
  if (!check || check.state === 'unchecked') return { key: 'gerovault.detail.check.unchecked' };
  if (check.state === 'providerOnly') return { key: 'gerovault.detail.check.providerOnly' };
  const methodKey = METHOD_KEYS[check.method ?? 'number'] ?? 'gerovault.detail.check.byNumber';
  if (check.state === 'stale') return { key: 'gerovault.detail.check.stale', methodKey };
  const date = check.at !== undefined ? formatDate(check.at * 1000) : '';
  return { key: check.state === 'checked' ? 'gerovault.detail.check.checked' : 'gerovault.detail.check.recorded', methodKey, date };
}

const labels = computed(() => new Map(props.facts.participants.map(p => [p.credential, checkLabel(checkOf(p.credential))])));
function labelOf(credential: string): { key: string; methodKey?: string; date?: string } {
  return labels.value.get(credential) ?? { key: 'gerovault.detail.check.unchecked' };
}

function toneOf(state: CosignerCheckState | undefined): string {
  if (state === 'checked') return 'var(--g-success)';
  if (state === 'recorded') return 'var(--g-text-2)';
  return 'var(--g-warning)';
}
</script>

<style scoped>
.vault-policy {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--g-s-4);
}
.vault-policy__card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
  min-width: 0;
}
.vault-policy__card h2,
.vault-policy__card p,
.vault-policy__rows,
.vault-policy__rows dd {
  margin: 0;
}
.vault-policy__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}
.vault-policy__rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.vault-policy__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--g-s-3);
}
.vault-policy__row dd {
  text-align: right;
  min-width: 0;
}
.vault-policy__sub {
  display: block;
}
.vault-policy__people {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.vault-policy__person {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
}
.vault-policy__who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.vault-policy__credential {
  overflow-wrap: anywhere;
}
</style>
