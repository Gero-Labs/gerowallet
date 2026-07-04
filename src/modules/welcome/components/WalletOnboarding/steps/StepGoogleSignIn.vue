<template>
  <div class="step-google-signin">
    <div class="google-signin-panel">
      <div class="google-signin-icon">
        <v-avatar size="56" color="rgba(255,255,255,0.05)">
          <v-img :src="google" contain width="28" />
        </v-avatar>
      </div>

      <template v-if="!email">
        <div class="google-signin-title">{{ $t('welcome.googleSignInButton') }}</div>
        <div class="google-signin-desc">{{ $t('welcome.onboardingDescGoogleSignIn') }}</div>
        <v-btn
          class="onb-btn google-signin-btn"
          depressed
          outlined
          :loading="signingIn"
          @click="signIn()"
        >
          <v-avatar size="18" class="mr-2">
            <v-img :src="google" contain />
          </v-avatar>
          {{ $t('welcome.googleSignInButton') }}
        </v-btn>
        <v-alert
          v-if="errorMessage"
          color="error"
          icon="mdi-alert-outline"
          outlined
          dense
          border="left"
          class="mt-3 mb-0"
        >
          <span class="text-body-2">{{ $t(errorMessage) }}</span>
        </v-alert>
      </template>

      <template v-else>
        <div class="google-signin-title">{{ $t('welcome.googleSignedInAs', { email }) }}</div>
        <v-btn text small color="primary" class="mt-1" @click="changeAccount()">
          {{ $t('welcome.googleChangeAccount') }}
        </v-btn>
      </template>
    </div>

    <!-- Navigation -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn class="onb-btn" depressed color="primary" :disabled="!email" @click="onContinue()">
        {{ $t('common.continue') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { google } from '@/utils/assets';
import type { GoogleWalletBgResponse } from './googleWalletMessages';

const emit = defineEmits<{
  (e: 'signed-in', payload: { idToken: string; email: string }): void;
  (e: 'back'): void;
}>();

const signingIn = ref(false);
const errorMessage = ref('');
const idToken = ref('');
const email = ref('');

const signIn = async (): Promise<void> => {
  signingIn.value = true;
  errorMessage.value = '';
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_WITH_GOOGLE,
      data: {},
    }) as GoogleWalletBgResponse;

    if (!response?.data?.success || !response.data.tokens?.idToken || !response.data.tokens?.accessToken) {
      throw new Error('welcome.googleSignInFailed');
    }

    const { accessToken, idToken: token } = response.data.tokens;

    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileResp.ok) {
      throw new Error('welcome.googleSignInFailed');
    }
    const profile = await profileResp.json();
    if (!profile?.email_verified || !profile?.email) {
      throw new Error('welcome.googleSignInFailed');
    }

    idToken.value = token;
    email.value = profile.email;
  } catch (error: unknown) {
    console.error('Google sign-in failed:', error instanceof Error ? error.message : 'unknown error');
    errorMessage.value = 'welcome.googleSignInFailed';
  } finally {
    signingIn.value = false;
  }
};

const changeAccount = (): void => {
  idToken.value = '';
  email.value = '';
};

const onContinue = (): void => {
  if (idToken.value && email.value) {
    emit('signed-in', { idToken: idToken.value, email: email.value });
  }
};
</script>

<style scoped>
.step-google-signin {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.google-signin-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px 16px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.google-signin-icon {
  margin-bottom: 16px;
}

.google-signin-title {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 4px;
}

.google-signin-desc {
  font-size: 13px;
  color: #94979c;
  max-width: 360px;
  margin-bottom: 20px;
  line-height: 1.5;
}

.google-signin-btn {
  text-transform: none;
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.onb-btn {
  border-radius: 8px !important;
  box-shadow: none !important;
}
</style>
