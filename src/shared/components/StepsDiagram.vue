<script setup lang="ts">
import { defineProps } from 'vue';
defineProps<{
    steps: any[]
}>();
</script>

<template>
    <v-container>
        <v-row>
            <v-col :key="i" v-for="(step, i) in steps" style="display:flex; flex-direction:column; align-items: center; position: relative;">
                <v-card class="border-gradient-gero-white ma-1 mb-3" style="z-index: 1;">
                    <v-avatar size="48">
                        <v-icon class="pa-4">{{ step.icon }}</v-icon>
                    </v-avatar>
                </v-card>
                <div class="connector-line" v-if="i !== steps.length - 1"></div>
                <div>{{ step.text }}</div>
            </v-col>
        </v-row>
    </v-container>
</template>

<style lang="scss" scoped>
    .connector-line{
        position: absolute;
        left: 50%;
        top: 40px;
        height: 1px;
        width: 100%;
        background-color: var(--gero-teal);
        z-index: 0;

        ::before{
            content: ' ';
        }
    }
</style>