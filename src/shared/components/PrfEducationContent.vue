<template>
  <v-card flat class="transparent" style="max-width: 540px;">
    <v-card-title class="justify-center text-h5">
      {{ $t('welcome.prfEducationTitle') }}
    </v-card-title>

    <v-card-text>
      <!-- Main explanation -->
      <div class="d-flex align-start mb-4">
        <v-avatar color="primary" size="56" class="mr-4">
          <v-icon dark large>mdi-shield-key</v-icon>
        </v-avatar>
        <div>
          <div class="text-body-1 white--text">
            {{ $t('welcome.prfEducationMainText') }}
          </div>
        </div>
      </div>

      <!-- Warning alert -->
      <v-alert
        color="warning"
        icon="mdi-alert-outline"
        outlined
        prominent
        border="left"
        class="mb-4"
      >
        <div class="font-weight-bold mb-1">{{ $t('welcome.prfDeviceBoundTitle') }}</div>
        <div class="text-body-2">{{ $t('welcome.prfDeviceBoundDesc') }}</div>
      </v-alert>

      <!-- Feature icons row -->
      <v-row justify="center" class="mt-4">
        <v-col cols="4" class="text-center">
          <v-avatar color="primary" size="48" class="mb-2" outlined>
            <v-icon>mdi-lock-open-outline</v-icon>
          </v-avatar>
          <div class="text-caption">{{ $t('welcome.prfFeatureNoPassword') }}</div>
        </v-col>
        <v-col cols="4" class="text-center">
          <v-avatar color="primary" size="48" class="mb-2" outlined>
            <v-icon>mdi-cellphone-key</v-icon>
          </v-avatar>
          <div class="text-caption">{{ $t('welcome.prfFeatureThisDevice') }}</div>
        </v-col>
        <v-col cols="4" class="text-center">
          <v-avatar color="primary" size="48" class="mb-2" outlined>
            <v-icon>mdi-content-save-outline</v-icon>
          </v-avatar>
          <div class="text-caption">{{ $t('welcome.prfFeatureSaveSeed') }}</div>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
// No props or emits needed - buttons handled by parent
</script>

<style scoped lang="scss">
// No additional styles needed - using Vuetify defaults
</style>
