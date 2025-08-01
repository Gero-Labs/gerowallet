<template>
  <v-card flat outlined>
    <v-card-title class="d-flex align-center">
      Action Permissions

      <v-tooltip bottom>
        <template v-slot:activator="{ on, attrs }">
          <v-icon v-bind="attrs" v-on="on" small class="ml-2">mdi-information-outline</v-icon>
        </template>
        <span> See who can take restricted actions</span>
      </v-tooltip>
    </v-card-title>
    <v-card-text>
      <v-simple-table dense class="transparent">
        <template v-slot:default>
          <thead>
            <tr>
              <th class="text-left text-caption font-weight-medium">Permission</th>
              <th class="text-center text-caption font-weight-medium">Everyone</th>
              <th class="text-center text-caption font-weight-medium">All Members</th>
              <th class="text-center text-caption font-weight-medium">Admin</th>
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
import { ref } from 'vue';

interface Permission {
  name: string;
  description: string;
  everyone: boolean;
  allMembers: boolean;
  admin: boolean;
}

const permissions = ref<Permission[]>([
  {
    name: 'Vote on Snapshot',
    description: 'Who can cast votes and comment on a Snapshot Governance Action?',
    everyone: true,
    allMembers: true,
    admin: true,
  },
  {
    name: 'Create Snapshot',
    description: 'Who can create a new Snapshot Governance Action?',
    everyone: false,
    allMembers: false,
    admin: true,
  },
  {
    name: 'Approve Snapshot',
    description: 'Who can approve a Pending Snapshot Governance Action before it goes public to a community-wide vote?',
    everyone: false,
    allMembers: false,
    admin: true,
  },
  {
    name: 'Manage Snapshot',
    description:
      'Who can edit a Snapshot Governance Action? This includes changing the name, description, or options, as well as deleting Snapshots.',
    everyone: false,
    allMembers: false,
    admin: true,
  },
  {
    name: 'Approve Incentive',
    description:
      'Who can approve Pending Incentive Completions submitted by community members who completed Quests and Raids?',
    everyone: false,
    allMembers: false,
    admin: true,
  },
  {
    name: 'Manage Incentive',
    description:
      'Who can edit an Incentive? This includes changing the name, description, and amount, as well as deleting Incentives.',
    everyone: false,
    allMembers: false,
    admin: true,
  },
]);
</script>
