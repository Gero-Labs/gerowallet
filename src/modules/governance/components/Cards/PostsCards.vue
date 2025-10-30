<template>
  <v-card flat outlined>
    <v-card-title>
      {{ $t('governance.posts') }}
      <v-tooltip top>
        <template v-slot:activator="{ on, attrs }">
          <v-icon small v-bind="attrs" v-on="on" class="ml-2">mdi-information-outline</v-icon>
        </template>
        <span>{{ $t('governance.postsTooltip') }}</span>
      </v-tooltip></v-card-title
    >
    <v-card-text class="text-center">{{ $t('governance.noPosts') }}</v-card-text>
  </v-card>
</template>

<script setup lang="ts"></script>

<style scoped></style>
