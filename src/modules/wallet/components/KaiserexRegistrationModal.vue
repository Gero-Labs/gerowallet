<template>
  <!-- Zione's page switches to its desktop layout (form beside the card art) at 1025 px of
       iframe width; 1200 leaves the iframe about 1140. Narrower windows get its stacked layout.
       The card may be as tall as the dialog (90vh), so it never cuts off its own content. -->
  <BaseDialog
    :isOpen="open"
    :title="t('card.kaiserexRegistration')"
    :subtitle="t('card.createKaiserexAccount')"
    :width="1200"
    height="90vh"
    :min-height="0"
    persistent
    @close="emit('close')"
  >
    <template #art>
      <IsoScene name="register" />
    </template>

    <div class="card-register">
      <div class="card-register__note">
        <span class="card-register__chip">
          <v-icon x-small>mdi-lock-outline</v-icon>
          {{ t('card.secureFormBy') }} · {{ host }}
        </span>
        <span class="t-caption">{{ t('card.activationEmailNote') }}</span>
      </div>

      <!-- Zione's own form. Its origin must be in the manifest's frame-src (cardProvider.spec.ts). -->
      <div class="card-register__frame">
        <iframe
          ref="registrationIframe"
          :src="iframeUrl"
          :title="t('card.kaiserexRegistration')"
          class="card-register__iframe"
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
          @load="onIframeLoad"
        />
        <div v-if="isLoading" class="card-register__loading">
          <v-progress-circular indeterminate color="primary" size="40" width="3" />
          <p class="t-body-sm">{{ t('card.loadingSecureForm') }}</p>
        </div>
      </div>

      <div class="card-register__actions">
        <GButton tier="tertiary" @click="emit('sign-in')">{{ t('card.alreadyRegisteredSignIn') }}</GButton>
        <GButton tier="secondary" @click="emit('close')">{{ t('common.close') }}</GButton>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { debugLog } from '@/utils/debug';
import { CARD_PROVIDER } from '@/modules/wallet/cardProvider';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'sign-in'): void;
}>();

const { t } = useTranslation();

const registrationIframe = ref<HTMLIFrameElement>();
const isLoading = ref(true);

// Registration lead form (Zione). Its origin must be in the manifest's frame-src.
const iframeUrl = CARD_PROVIDER.registrationUrl;
const host = new URL(iframeUrl).host;

let loadTimeout: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.open,
  open => {
    if (loadTimeout) clearTimeout(loadTimeout);
    if (!open) return;
    isLoading.value = true;
    // A fresh query string so a cached, half-filled form never comes back.
    nextTick(() => {
      if (registrationIframe.value) registrationIframe.value.src = `${iframeUrl}?_t=${Date.now()}`;
    });
    // Some pages never fire load inside a sandboxed frame; stop covering it after 5 s.
    loadTimeout = setTimeout(() => {
      if (isLoading.value) {
        debugLog('Card registration frame: load event timed out');
        isLoading.value = false;
      }
    }, 5000);
  },
);

function onIframeLoad(): void {
  isLoading.value = false;
}
</script>

<style lang="scss" scoped>
.card-register {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-2) var(--g-s-2) 0;
}

.card-register__note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2) var(--g-s-3);
}

/* Justified solid: a chip is a control-scale label. */
.card-register__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  padding: 2px var(--g-s-2);
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-2);
  font-size: 12px;
}

/* Justified solid: the frame holds a third-party page; a solid edge sets it apart from glass.
   260px is the rest of the dialog (padding, header, note, buttons), so the whole dialog fits
   the 90vh Vuetify allows and only the provider's page scrolls. Its desktop form is ~880px. */
.card-register__frame {
  position: relative;
  height: clamp(360px, calc(90vh - 260px), 960px);
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-2);
  background: var(--g-raised);
  overflow: hidden;
}

.card-register__iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.card-register__loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-3);
  background: var(--g-surface);
}

.card-register__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--g-s-2);
}
</style>
