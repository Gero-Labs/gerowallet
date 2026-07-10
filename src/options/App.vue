<template>
  <div>
    <component :is="$route.meta['layout'] || 'div'">
      <router-view></router-view>
    </component>
    <AgentDock v-if="isAgentVisible" />
    <v-overlay v-show="isLoading" opacity="0.9" style="text-align: center;">
      <v-card flat style="background-color: transparent!important; text-align: -webkit-center;">
        <video :src="assetsUtil.loadingAnimation" playsinline autoplay muted loop style="width: 120px; object-fit: contain; object-position: center bottom; left: 0; top: 0;">
        </video>
        <v-progress-linear
            :value="progress"
            :indeterminate="progress === 0"
            color="#16d9f3"
            background-color="rgba(255,255,255,0.15)"
            height="20"
            rounded
            class="glow-bar"
            style="width: 220px"
        >
          <span v-if="progress > 0" style="color: black; font-size: 11px; font-weight: 700;">{{ progress }}%</span>
        </v-progress-linear>
        <v-card-text style="color: white; height: 76px" v-html="text"></v-card-text>
      </v-card>
    </v-overlay>
    <notifications></notifications>
    <v-snackbar
      content-class="custom-snackbar"
      outlined
        v-model="snackbarPlugin.active"
        :timeout="snackbarPlugin.timeout"
        :color="snackbarPlugin.color"
        bottom
        style="font-family: var(--g-font-ui);"
        transition="scroll-y-transition"
    >
      {{ snackbarPlugin.text }}
    </v-snackbar>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, toRefs, watch, getCurrentInstance, onMounted } from 'vue'
import snackbar from "@/plugins/snackbar";
import assts from '@/utils/assets';
import { loadingState } from '@/stores/loading';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import AgentDock from '@/sidepanel/components/AgentDock.vue';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { useChainAccent } from '@/shared/composables/useChainAccent';

// Bootstrap the single chain-accent writer at the dashboard root. It lives here
// rather than in ContentLayout because ContentLayout unmounts on the welcome
// route, which would strand the module-level latch as a permanent no-op.
useChainAccent();

const { loading, isRestoring, text, progress } = toRefs(loadingState);
const geroConfig = toRefs(geroStore).config;

const snackbarPlugin = ref(snackbar);
const assetsUtil = ref(assts);
const vmProxy = getCurrentInstance()!.proxy;

const isLoading = computed(() => {
  return loading.value || isRestoring.value;
});

const isAgentVisible = computed(() => {
  return featureFlagsStore.isCopilotEnabled() && !!walletStore.loggedWallet && !walletStore.isLocked;
});

// Check auto-lock immediately when page loads/becomes visible
onMounted(async () => {
  try {
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.CHECK_AUTO_LOCK,
      data: {}
    });
  } catch (error) {
    console.error('❌ Failed to trigger auto-lock check on mount:', error);
  }
});

// Watch geroStore for locale changes (global preference) instead of walletStore
// CRITICAL: The initial locale is set by main.ts BEFORE Vue mounts
// This watcher should only react to SUBSEQUENT changes made by the user
watch(() => geroConfig.value?.locale, async (newLocale, oldLocale) => {
  // Skip if no locale value or i18n not ready
  if (!newLocale || !vmProxy.$i18n) return;

  // CRITICAL: Skip if this is the initial watcher run and i18n is already set correctly
  // This prevents the watcher from overwriting the locale set by main.ts
  // The geroStore default is 'us', but main.ts may have already loaded 'de' from storage
  if (vmProxy.$i18n.locale === newLocale) {
    return; // Already at the correct locale, no action needed
  }

  // Skip if oldLocale is undefined/null (first run) and newLocale is the default 'us'
  // This means geroStore hasn't been hydrated yet, so trust main.ts's locale setting
  if (!oldLocale && newLocale === 'us' && vmProxy.$i18n.locale !== 'us') {
    console.log('🔄 App.vue: Skipping initial hydration reset, current i18n.locale:', vmProxy.$i18n.locale);
    return;
  }

  // Proceed with locale change
  console.log('🔄 App.vue: Locale change detected:', oldLocale, '->', newLocale);
  const { loadLanguage } = await import('@/plugins/i18n');
  try {
    await loadLanguage(newLocale);
    vmProxy.$i18n.locale = newLocale;
    console.log('✅ App.vue: i18n.locale updated to:', newLocale);
  } catch (error) {
    console.error(`Failed to load language ${newLocale}:`, error);
  }
}, { immediate: true, deep: true });
</script>
<style lang="scss">
.v-application {
  background-color: var(--v-background-base) !important;
}
.v-navigation-drawer {
  background-color: var(--v-navigationDrawerBackground-base) !important;
}
.v-app-bar.v-toolbar.v-sheet {
  background-color: transparent !important;
}
.v-card {
  background-color: var(--v-cardBackground-base) !important;
}
.v-dialog__content--active {
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(4px);
}
.v-carousel__controls {
  background-color: transparent!important;
}
.dialogStyle {
  -webkit-backdrop-filter: blur(12px) brightness(0.2);
  backdrop-filter: blur(12px);
  background: #000000ab;
  border: solid 2px #ffffff44;
}

.dialogStyle.darken {
  background: #000000e0;
}

.v-dialog:not(.v-dialog--fullscreen) {
  max-height: 100%;
}

.smallToolTip {
  padding: 1px 2px;
  background-color: rgba(30, 30, 30, 0.88);
  border: 1px solid #404040;
  font-size: 10px !important;
  opacity: 0.9 !important;
}
.v-text-field--outlined.no-margin-append-outer .v-input__append-outer {
  margin: 0 0 0 4px !important;
}

.v-text-field--outlined.no-margin-append-outer .v-input__append-inner {
  margin: 0 !important;
}

.custom-tooltip {
  background-color: rgba(0, 0, 0, 0.4) !important;
  backdrop-filter: blur(20px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  isolation: isolate !important;
  padding: 12px 16px !important;
  max-width: 300px !important;
}
.v-snack:not(.v-snack--has-background) .v-snack__wrapper {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  background-color: transparent;
  border-radius: 12px !important;
}

.voerro-notification-theme-error {
  border-radius: 12px !important;
  border: 1px solid #ff6464d1!important;
  color: #f5fff6;
}

.voerro-notification-theme-success {
  border-radius: 12px !important;
  border: 1px solid #47cd89d1!important;
  color: #f5fbf8;
}

.voerro-notification {
  background-color: rgba(0, 0, 0, 0.4) !important;
  backdrop-filter: blur(20px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  isolation: isolate !important;
  padding: 12px 16px !important;
  font-size: 14px !important;
  overflow-wrap: anywhere;
}

.voerro-notifications-container {
  z-index: 99999 !important;
  border-radius: .3rem;
  width: max-content !important;
  max-width: min(480px, calc(100vw - 40px)) !important;
  min-width: unset !important;
}

.v-select.v-text-field input {
  cursor: pointer!important;
}

.glow-bar {
  animation: glow-pulse 3s ease-in-out infinite;
}

@keyframes glow-pulse {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(22, 217, 243, 0.3)) drop-shadow(0 0 8px rgba(22, 217, 243, 0.15)); }
  50% { filter: drop-shadow(0 0 8px rgba(22, 217, 243, 0.6)) drop-shadow(0 0 16px rgba(22, 217, 243, 0.35)); }
}

.glow-bar,
.glow-bar * {
  text-align: left !important;
}

.glow-bar {
  border: 1px solid rgba(22, 217, 243, 0.3) !important;
  background: rgba(255, 255, 255, 0.05) !important;
}

.glow-bar .v-progress-linear__background {
  background: transparent !important;
}

.glow-bar .v-progress-linear__determinate {
  position: relative !important;
  background: #0a8fa8 !important;
  overflow: hidden !important;
}

.glow-bar .v-progress-linear__determinate::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 80%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(126, 240, 255, 0.3), transparent);
  animation: shimmer-sweep 3s ease-in-out infinite;
}

@keyframes shimmer-sweep {
  0% { left: -80%; }
  100% { left: 100%; }
}
</style>
