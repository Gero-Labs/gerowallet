<template>
  <v-card flat outlined>
    <v-card-title>
      Governance
      <v-tooltip top class="ml-2">
        <template v-slot:activator="{ on, attrs }">
          <v-icon small v-bind="attrs" v-on="on" class="ml-2">mdi-information-outline</v-icon>
        </template>
        <span>Governance is how organizations make collective decisions.</span>
      </v-tooltip>
    </v-card-title>
    <v-card-text class="text-center"> There are currently no governance proposals. </v-card-text>
  </v-card>
</template>

<script setup lang="ts"></script>

<style scoped></style>
