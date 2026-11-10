import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwires for the "Data paused" surfaces. The rule itself (tip older
// than ten minutes, clock tolerance, chip state) is unit-tested in
// src/chains/midnight/midnightDataFreshness.spec.ts, the ticking age and the
// Cardano-side tip read in useMidnightDataFreshness.spec.ts, the held DUST
// reading in useMidnightDustLive.spec.ts, and the cNIGHT line in
// DustGenerationLine.paused.spec.ts. These pin that each surface uses them.
const src = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(src, path), 'utf8');

describe('Midnight data paused wiring', () => {
  it('the header chip is amber "Paused" with no streaming animation, and the tooltip says why', () => {
    const layout = read('modules/navigation/layouts/ContentLayout.vue');
    expect(layout).toContain('midnightNetworkChipState(midnightNetworkStatus.value, midnightFreshness.paused.value)');
    // "Online" (and its sync animation) is only the 'online' state, never 'paused'.
    expect(layout).toContain("const isMidnightConnected = computed(() => midnightChipState.value === 'online');");
    expect(layout).toContain(":color=\"isMidnightPaused ? 'warning'");
    expect(layout).toMatch(/v-if="isMidnightPaused" class="network-paused-label[^"]*"[^>]*>\s*\{\{ t\('midnight\.dataPaused\.chip'\) \}\}/);
    expect(layout).toContain("t('midnight.dataPaused.detail', { block: midnightFreshness.height.value, age: midnightFreshness.ageLabel.value })");
    // The activator is focusable, "Last sync" is hidden while paused, and the sentence comes last.
    expect(layout).toMatch(/v-bind="activatorProps"\s+tabindex="0"/);
    expect(layout).toContain('<div v-if="!isMidnightPaused"><strong>{{ t(\'navigation.lastSync\') }}');
    const tooltip = layout.slice(layout.indexOf('<div class="network-tooltip-content">'), layout.indexOf('</v-tooltip>', layout.indexOf('<div class="network-tooltip-content">')));
    expect(tooltip.indexOf('network-paused-detail')).toBeGreaterThan(tooltip.indexOf("t('navigation.status')"));
    expect(layout).toContain("isMidnightPaused ? t('midnight.dataPaused.chip') : (isMidnight ? isMidnightConnected : connected) ? t('navigation.online')");
  });

  it('the dashboard caption shows only while paused', () => {
    const chart = read('modules/dashboard/components/MidnightPortfolioChart.vue');
    expect(chart).toMatch(/<div v-if="dataPaused" class="data-paused-caption t-caption g-num"[^>]*>\s*\{\{ \$t\('midnight\.dataPaused\.caption', \{ block: tipHeight, age: tipAge \}\) \}\}/);
  });

  it('the dashboard battery labels an estimate and shows no projection while paused', () => {
    const gauge = read('modules/dashboard/components/MidnightDustGauge.vue');
    expect(gauge).toMatch(/v-if="dustEstimate" class="dust-gauge__estimate t-caption"[^>]*>\{\{ \$t\('midnight\.dataPaused\.estimate'\) \}\}/);
    expect(gauge).toContain('&& !dustEstimate.value);');
    expect(gauge).toContain("isRegistered && !dustEstimate ? `+${dustRateFmt} ${dustCurrency}/s` : '—'");
    expect(gauge).toMatch(/const timeToFullLabel = computed\(\(\) => \{[\s\S]*?if \(dustEstimate\.value\) return '—';/);
  });

  it('the side panel battery shows "Estimate · As of block" in place of the rate while paused', () => {
    const mini = read('sidepanel/components/MiniDustGauge.vue');
    expect(mini).toMatch(/<span v-if="dustEstimate" class="mini-dust__estimate g-num"[\s\S]*?midnight\.dataPaused\.estimateCaption/);
    expect(mini).toContain('<span v-else-if="isRegistered">+{{ rateFmt }}');
    expect(mini).toContain('&& !dustEstimate.value);');
  });

  it('both DUST registration dialogs keep the pill short and put the paused sentence on its own line', () => {
    const native = read('modules/dashboard/dialogs/DustRegistrationDialog.vue');
    expect(native).toContain("const pendingHelp = computed(() => (midnightDataPaused.value ? '' : t('midnight.relayFewHours')));");
    expect(native).toMatch(/<p v-if="pausedNoteShown" class="paused-note t-body-sm"[^>]*>\s*\{\{ t\('midnight\.dataPaused\.cnightPending'\) \}\}/);
    const cnight = read('modules/dashboard/dialogs/CnightDustRegistrationDialog.vue');
    expect(cnight).toContain("if (registrationStatus.value === 'Pending') return midnightDataPaused.value ? '' : t('midnight.relayFewHours');");
    expect(cnight).toMatch(/<p v-if="registrationStatus === 'Pending' && midnightDataPaused" class="paused-note t-body-sm"/);
  });
});
