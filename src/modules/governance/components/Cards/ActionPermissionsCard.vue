<template>
  <v-card flat outlined>
    <v-card-title class="d-flex align-center">
      {{ $t('governance.actionPermissions') }}

      <v-tooltip bottom>
        <template v-slot:activator="{ on, attrs }">
          <v-icon v-bind="attrs" v-on="on" small class="ml-2">mdi-information-outline</v-icon>
        </template>
        <span> {{ $t('governance.seeWhoCanTakeActions') }}</span>
      </v-tooltip>
    </v-card-title>
    <v-card-text>
      <v-simple-table dense class="transparent">
        <template v-slot:default>
          <thead>
            <tr>
              <th class="text-left text-caption font-weight-medium">{{ $t('governance.permission') }}</th>
              <th class="text-center text-caption font-weight-medium">{{ $t('governance.everyone') }}</th>
              <th class="text-center text-caption font-weight-medium">{{ $t('governance.allMembers') }}</th>
              <th class="text-center text-caption font-weight-medium">{{ $t('governance.admin') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="permission in permissions" :key="permission.name">
              <td class="text-left text-caption">
                <div class="d-flex align-center">
                  {{ permission.name }}
                  <v-tooltip bottom>
                    <template v-slot:activator="{ on, attrs }">
                      <v-icon v-bind="attrs" v-on="on" x-small class="ml-1">mdi-information-outline</v-icon>
                    </template>
                    <span>{{ permission.description }}</span>
                  </v-tooltip>
                </div>
              </td>
              <td class="text-center">
                <v-icon v-if="permission.everyone" small color="success"> mdi-check-circle </v-icon>
              </td>
              <td class="text-center">
                <v-icon v-if="permission.allMembers" small color="success"> mdi-check-circle </v-icon>
              </td>
              <td class="text-center">
                <v-icon v-if="permission.admin" small color="success"> mdi-check-circle </v-icon>
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

const { t } = useTranslation();

interface Permission {
  name: string;
  description: string;
  everyone: boolean;
  allMembers: boolean;
  admin: boolean;
}

const permissions = ref<Permission[]>([
  {
    name: t('governance.voteOnSnapshot'),
    description: t('governance.voteOnSnapshotDesc'),
    everyone: true,
    allMembers: true,
    admin: true,
  },
  {
    name: t('governance.createSnapshot'),
    description: t('governance.createSnapshotDesc'),
    everyone: false,
    allMembers: false,
    admin: true,
  },
  {
    name: t('governance.approveSnapshot'),
    description: t('governance.approveSnapshotDesc'),
    everyone: false,
    allMembers: false,
    admin: true,
  },
  {
    name: t('governance.manageSnapshot'),
    description: t('governance.manageSnapshotDesc'),
    everyone: false,
    allMembers: false,
    admin: true,
  },
  {
    name: t('governance.approveIncentive'),
    description: t('governance.approveIncentiveDesc'),
    everyone: false,
    allMembers: false,
    admin: true,
  },
  {
    name: t('governance.manageIncentive'),
    description: t('governance.manageIncentiveDesc'),
    everyone: false,
    allMembers: false,
    admin: true,
  },
]);
</script>
