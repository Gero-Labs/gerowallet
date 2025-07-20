<template>
  <v-card class="transparent" flat>
    <v-layout>
      <v-row>
        <v-col cols="12" xl="8" lg="8">
          <v-card flat outlined>
            <v-card-title>Swap</v-card-title>
            <v-card-text class="text-center justify-center">
              <SwapWidget></SwapWidget>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" xl="4" lg="4">
          <v-card flat outlined class="fill-height">
            <v-card-title>Pending Orders</v-card-title>
          </v-card>
        </v-col>
      </v-row>
    </v-layout>
  </v-card>
</template>
<script setup lang="ts">
import SwapWidget from '@/modules/swap/components/SwapWidget.vue';
</script>

<style scoped>
.mt-2 {
  margin-top: 8px;
}

.z-index-5 {
  z-index: 5;
}

.mt-n4 {
  margin-top: -18px;
}

.rounded-10 {
  border-radius: 10px;
}

.centered-input.v-text-field.v-text-field--solo .v-input__control input {
  text-align: center;
  font-size: 14px;
  padding: 0;
}

.theme--dark.centered-input.v-text-field--solo > .v-input__control > .v-input__slot {
  background: transparent;
}

.text-white input {
  color: white !important;
}

.text-black input {
  color: black !important;
}

.text-white.opacity {
  opacity: 0.3;
}

@keyframes metronome-example {
  from {
    transform: scale(.5);
  }

  to {
    transform: scale(1);
  }
}

.v-avatar--metronome {
  animation-name: metronome-example;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}
</style>
