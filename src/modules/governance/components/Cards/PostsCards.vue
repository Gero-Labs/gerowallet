<template>
  <v-card flat outlined>
    <v-card-title>
      Posts
      <v-tooltip top>
        <template v-slot:activator="{ on, attrs }">
          <v-icon small v-bind="attrs" v-on="on" class="ml-2">mdi-information-outline</v-icon>
        </template>
        <span>Check important posts and updates from your organization.</span>
      </v-tooltip></v-card-title
    >
    <v-card-text class="text-center"> There are currently no posts. </v-card-text>
  </v-card>
</template>

<script setup lang="ts"></script>

<style scoped></style>
