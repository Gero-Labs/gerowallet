<template>
  <v-card flat outlined>
    <v-card-title> {{ $t('governance.members') }} </v-card-title>
    <v-card-text>
      <div v-if="Object.keys(members).length === 0" class="text-center">{{ $t('governance.noMembersYet') }}</div>
      <v-simple-table v-else dense class="transparent">
        <template v-slot:default>
          <thead>
            <tr>
              <th class="text-left text-caption font-weight-medium">{{ $t('governance.memberAddress') }}</th>
              <th class="text-center text-caption font-weight-medium">{{ $t('governance.lastActivity') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(timestamp, address) in members" :key="address">
              <td class="text-left text-caption">
                <div class="d-flex align-center">
                  {{ formatAddress(address) }}
                  <v-tooltip top>
                    <template v-slot:activator="{ on, attrs }">
                      <v-btn v-bind="attrs" v-on="on" icon x-small @click="copyToClipboard(address)" class="mr-1">
                        <v-icon x-small>mdi-content-copy</v-icon>
                      </v-btn>
                    </template>
                    <span>{{ address }}</span>
                  </v-tooltip>
                </div>
              </td>
              <td class="text-center text-caption">
                {{ formatDate(timestamp) }}
              </td>
            </tr>
          </tbody>
        </template>
      </v-simple-table>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref } from 'vue';
import { onMounted } from 'vue';
import clarityApi from '@/api/clarity-api';
import snackbar from '@/plugins/snackbar';


const { t } = useTranslation();
const members = ref<Record<string, number>>({});

const formatAddress = (address: string): string => {
  if (address.length <= 20) return address;
  return `${address.substring(0, 10)}...${address.substring(address.length - 10)}`;
};

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
};

const copyToClipboard = async (address: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(address);
    snackbar.fireSuccess(t('common.addressCopied'));
  } catch (error) {
    console.error('Failed to copy address:', error);
  }
};

onMounted(() => {
  clarityApi.getDaoMembers().then(res => {
    members.value = res.data;
  });
});
</script>
