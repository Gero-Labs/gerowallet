<template>
  <v-app>
    <v-main><v-container>
      <h1>{{ t('title') }}</h1>
      <p data-testid="surface">{{ surface }} / {{ target }}</p>
      <v-alert type="info" variant="tonal">{{ t('scope') }}</v-alert>
      <label>{{ t('language') }} <select v-model="locale" data-testid="locale"><option value="us">English</option><option value="de">Deutsch</option><option value="es">Español</option></select></label>
      <p data-testid="localized">{{ t('message') }} — {{ t('email') }}</p>
      <dl>
        <dt>{{ t('wallet') }}</dt><dd data-testid="wallet">{{ snapshot.wallet }}</dd>
        <dt>{{ t('network') }}</dt><dd data-testid="network">{{ snapshot.network }}</dd>
        <dt>{{ t('revision') }}</dt><dd data-testid="revision">{{ snapshot.revision }}</dd>
        <dt>{{ t('approvals') }}</dt><dd data-testid="approvals">{{ snapshot.approvals }}</dd>
        <dt>{{ t('session') }}</dt><dd data-testid="locked">{{ String(snapshot.locked) }}</dd>
        <dt>{{ t('inFlight') }}</dt><dd data-testid="in-flight">{{ diagnostics.inFlight }}</dd>
      </dl>
      <v-btn data-testid="unlock" @click="request('unlock')">{{ t('unlock') }}</v-btn>
      <v-btn data-testid="lock" @click="request('lock')">{{ t('lock') }}</v-btn>
      <v-btn data-testid="wallet-change" @click="request('wallet')">{{ t('switchWallet') }}</v-btn>
      <v-btn data-testid="network-change" @click="request('network')">{{ t('switchNetwork') }}</v-btn>
      <nav><router-link to="/" data-testid="home-link">{{ t('home') }}</router-link> · <router-link to="/approval" data-testid="approval-link">{{ t('approval') }}</router-link></nav>
      <router-view v-slot="{ Component }"><keep-alive><component :is="Component" /></keep-alive></router-view>
    </v-container></v-main>
  </v-app>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { diagnostics, request, snapshot } from './state';
defineProps<{ surface: string; target: string }>();
const { t, locale } = useI18n();
</script>
