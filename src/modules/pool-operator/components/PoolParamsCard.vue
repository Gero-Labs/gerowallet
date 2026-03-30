<template>
  <div class="pp-card liquid-glass">
    <div class="card-header">
      <v-icon size="14" color="white" class="mr-1">mdi-tune</v-icon>
      <span>{{ $t('poolOperator.coreParameters') }}</span>
    </div>

    <!-- Core params grid -->
    <div class="pp-grid">
      <div class="pp-item">
        <span class="pp-val">{{ formatAda(pledge) }}</span>
        <span class="pp-lbl">{{ $t('poolOperator.pledge') }}</span>
        <span v-if="livePledge != null" class="pp-sub" :class="pledgeMet ? 'pp-ok' : 'pp-err'">
          {{ $t('poolOperator.live') }}: {{ formatAda(livePledge) }}
        </span>
      </div>
      <div class="pp-item">
        <span class="pp-val">{{ formatAda(cost) }}</span>
        <span class="pp-lbl">{{ $t('poolOperator.cost') }}</span>
      </div>
      <div class="pp-item">
        <span class="pp-val">{{ margin }}%</span>
        <span class="pp-lbl">{{ $t('poolOperator.margin') }}</span>
      </div>
      <div class="pp-item">
        <span class="pp-val">{{ saturation }}%</span>
        <span class="pp-lbl">{{ $t('poolOperator.saturation') }}</span>
        <div class="pp-bar">
          <div class="pp-bar-fill" :style="{ width: Math.min(parseFloat(saturation) || 0, 100) + '%' }" />
        </div>
      </div>
      <div class="pp-item">
        <span class="pp-val">{{ relays.length }}</span>
        <span class="pp-lbl">{{ $t('poolOperator.relays') }}</span>
      </div>
      <div class="pp-item">
        <span class="pp-val">{{ ros }}%</span>
        <span class="pp-lbl">{{ $t('poolOperator.ros') }}</span>
      </div>
    </div>

    <!-- Detail sections in horizontal flow -->
    <div class="pp-details">
      <!-- Relays detail -->
      <div v-if="relays.length" class="pp-section">
        <div class="pp-section-title">
          <v-icon size="12" color="white" class="mr-1">mdi-access-point-network</v-icon>
          {{ $t('poolOperator.relays') }}
        </div>
        <div v-for="(relay, i) in relays" :key="i" class="relay-row">
          <v-icon size="12" :color="relayColor(relay)" class="mr-1">{{ relayIcon(relay) }}</v-icon>
          <span class="relay-type">{{ relayType(relay) }}</span>
          <span class="relay-addr">{{ relayAddr(relay) }}</span>
          <span v-if="relayPort(relay)" class="relay-port">:{{ relayPort(relay) }}</span>
        </div>
      </div>

      <!-- Metadata -->
      <div v-if="metadataUrl" class="pp-section">
        <div class="pp-section-title">
          <v-icon size="12" color="white" class="mr-1">mdi-tag-text-outline</v-icon>
          {{ $t('poolOperator.poolMetadata') }}
        </div>
        <div class="meta-row">
          <span class="meta-label">URL</span>
          <span class="meta-value meta-link" @click="copyText(metadataUrl)">
            {{ metadataUrl }}
            <v-icon x-small color="rgba(255,255,255,0.3)">mdi-content-copy</v-icon>
          </span>
        </div>
        <div v-if="metadataHash" class="meta-row">
          <span class="meta-label">Hash</span>
          <span class="meta-value meta-hash" @click="copyText(metadataHash)">
            {{ truncateHash(metadataHash) }}
            <v-icon x-small color="rgba(255,255,255,0.3)">mdi-content-copy</v-icon>
          </span>
        </div>
      </div>

      <!-- Owners + Reward combined -->
      <div v-if="owners.length || rewardAddr" class="pp-section">
        <div v-if="owners.length">
          <div class="pp-section-title">
            <v-icon size="12" color="white" class="mr-1">mdi-account-key</v-icon>
            {{ $t('poolOperator.owners') }} ({{ owners.length }})
          </div>
          <div v-for="(owner, i) in owners" :key="i" class="meta-row">
            <span class="meta-value meta-hash" @click="copyText(owner)">
              {{ truncateHash(owner) }}
              <v-icon x-small color="rgba(255,255,255,0.3)">mdi-content-copy</v-icon>
            </span>
          </div>
        </div>
        <div v-if="rewardAddr" :style="owners.length ? 'margin-top: 8px' : ''">
          <div class="pp-section-title">
            <v-icon size="12" color="white" class="mr-1">mdi-wallet-outline</v-icon>
            {{ $t('poolOperator.rewardAccount') }}
          </div>
          <div class="meta-row">
            <span class="meta-value meta-hash" @click="copyText(rewardAddr)">
              {{ truncateHash(rewardAddr) }}
              <v-icon x-small color="rgba(255,255,255,0.3)">mdi-content-copy</v-icon>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import snackbar from '@/plugins/snackbar';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

defineProps<{
  pledge: any;
  cost: any;
  margin: string;
  saturation: string;
  relays: any[];
  ros: string;
  livePledge: any;
  pledgeMet: boolean;
  metadataUrl?: string;
  metadataHash?: string;
  rewardAddr?: string;
  owners?: string[];
}>();

function formatAda(lovelace: any): string {
  if (!lovelace && lovelace !== 0) return '0';
  return (Number(lovelace) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function relayType(r: any): string {
  if (r.dns || r.hostname || r.__typename === 'RelayByName') return 'DNS';
  if (r.ipv4 || r.ipv6 || r.__typename === 'RelayByAddress') return r.ipv6 ? 'IPv6' : 'IPv4';
  if (r.srv || r.dnsName || r.__typename === 'RelayByNameMultihost') return 'SRV';
  return 'Relay';
}

function relayIcon(r: any): string {
  if (r.srv || r.dnsName || r.__typename === 'RelayByNameMultihost') return 'mdi-dns';
  if (r.ipv4 || r.ipv6 || r.__typename === 'RelayByAddress') return 'mdi-ip-network';
  return 'mdi-web';
}

function relayColor(r: any): string {
  if (r.ipv4 || r.ipv6 || r.__typename === 'RelayByAddress') return '#FDB022';
  return '#2DF0F7';
}

function relayAddr(r: any): string {
  return r.dns || r.hostname || r.ipv4 || r.ipv6 || r.srv || r.dnsName || r.ip || '';
}

function relayPort(r: any): number | undefined {
  return r.port || undefined;
}

function truncateHash(hash: string): string {
  if (!hash || hash.length <= 24) return hash;
  return hash.substring(0, 12) + '...' + hash.substring(hash.length - 12);
}

function copyText(text: string) {
  navigator.clipboard.writeText(text);
  snackbar.fireSuccess(t('common.copied'));
}
</script>

<style scoped>
.pp-card { padding: 14px; }

.card-header {
  font-size: 11px; font-weight: 600; color: white;
  text-transform: uppercase; letter-spacing: 0.5px;
  display: flex; align-items: center; margin-bottom: 12px;
}

.pp-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
  overflow: hidden;
}

.pp-item {
  padding: 10px;
  background: rgba(0,0,0,0.12);
  text-align: center;
}

.pp-val {
  display: block; font-size: 16px; font-weight: 700; color: rgba(255,255,255,0.95);
  font-variant-numeric: tabular-nums; line-height: 1.2;
}

.pp-lbl {
  display: block; font-size: 10px; color: rgba(255,255,255,0.45);
  text-transform: uppercase; letter-spacing: 0.3px; margin-top: 2px;
}

.pp-sub { display: block; font-size: 10px; margin-top: 2px; }
.pp-ok { color: #75E0A7; }
.pp-err { color: #FDA29B; }

.pp-bar { height: 2px; background: rgba(255,255,255,0.06); border-radius: 1px; margin-top: 4px; }
.pp-bar-fill { height: 100%; background: linear-gradient(90deg, #00c7f3, #00ffd1); border-radius: 1px; transition: width 0.6s; }

/* Detail sections - horizontal flow */
.pp-details {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0 16px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.04);
}

@media (max-width: 700px) {
  .pp-details { grid-template-columns: 1fr; }
}

.pp-section {
  padding: 4px 0;
}

.pp-section-title {
  font-size: 10px; font-weight: 600; color: white;
  text-transform: uppercase; letter-spacing: 0.4px;
  display: flex; align-items: center; margin-bottom: 6px;
}

/* Relay rows */
.relay-row {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 0;
  font-size: 12px;
}

.relay-type {
  font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.5);
  min-width: 28px;
}

.relay-addr {
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  color: rgba(255,255,255,0.8);
  word-break: break-all;
}

.relay-port {
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  color: rgba(45,240,247,0.7);
}

/* Metadata rows */
.meta-row {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 0;
  font-size: 12px;
}

.meta-label {
  font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.4);
  min-width: 32px; text-transform: uppercase;
}

.meta-value {
  font-family: 'Roboto Mono', monospace;
  font-size: 11px;
  color: rgba(255,255,255,0.7);
  word-break: break-all;
}

.meta-link, .meta-hash {
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  transition: color 0.15s;
}

.meta-link:hover, .meta-hash:hover { color: rgba(255,255,255,0.9); }
</style>
