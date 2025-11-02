<template>
  <v-card flat outlined>
    <v-card-title>
      {{ $t('governance.governance') }}
      <v-tooltip top class="ml-2">
        <template v-slot:activator="{ on, attrs }">
          <v-icon small v-bind="attrs" v-on="on" class="ml-2">mdi-information-outline</v-icon>
        </template>
        <span>{{ $t('governance.governanceTooltip') }}</span>
      </v-tooltip>
    </v-card-title>
    <v-card-text class="text-center">{{ $t('governance.noGovernanceProposals') }}</v-card-text>
  </v-card>
</template>

<script setup lang="ts"></script>

<style scoped></style>
