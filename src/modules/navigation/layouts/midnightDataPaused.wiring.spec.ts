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
    expect(layout).toContain("isMidnightPaused ? t('midnight.dataPaused.chip') : (isMidnight ? isMidnightConnected : connected) ? t('navigation.online')");
  });

  it('the dashboard caption shows only while paused', () => {
    const chart = read('modules/dashboard/components/MidnightPortfolioChart.vue');
    expect(chart).toMatch(/<div v-if="dataPaused" class="data-paused-caption[^"]*"[^>]*>\s*\{\{ \$t\('midnight\.dataPaused\.caption', \{ block: tipHeight, age: tipAge \}\) \}\}/);
  });

  it.each([
    'modules/dashboard/components/MidnightDustGauge.vue',
    'sidepanel/components/MiniDustGauge.vue',
  ])('%s labels the battery an estimate and stops the charging animation while paused', (path) => {
    const gauge = read(path);
    expect(gauge).toMatch(/v-if="dustEstimate"[^>]*>[^<]*\$t\('midnight\.dataPaused\.estimate'\)/);
    expect(gauge).toContain('&& !dustEstimate.value);');
  });

  it('both DUST registration dialogs switch the pending note while paused', () => {
    expect(read('modules/dashboard/dialogs/DustRegistrationDialog.vue'))
      .toContain("midnightDataPaused.value ? t('midnight.dataPaused.cnightPending') : t('midnight.relayFewHours')");
    expect(read('modules/dashboard/dialogs/CnightDustRegistrationDialog.vue'))
      .toContain("midnightDataPaused.value ? t('midnight.dataPaused.cnightPending') : t('midnight.relayFewHours')");
  });
});
