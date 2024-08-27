<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" :min-height="300" :height="600" :width="480" title="Select a Token" subtitle="">
    <v-card-title class="pa-0 px-2">
      <v-text-field
        v-model="search"
        placeholder="Search by name or policy"
        outlined
        prepend-inner-icon="mdi-magnify"
        @input="onSearchInput"
      ></v-text-field>
    </v-card-title>

    <v-card-title class="pa-0 px-2 pb-2" v-if="favoriteTokens.length">
      <v-chip
        v-for="(unit, index) in favoriteTokens"
        :key="index"
        class="pl-1 pr-2 mx-1 mb-1"
      >
        <v-avatar>
          <v-img :src="resolveToken(unit)['img']" />
        </v-avatar>&nbsp;
        {{ resolveToken(unit)['ticker'] }}
      </v-chip>
    </v-card-title>

    <v-card-text class="pb-0 px-2">
      <v-list nav dense class="pa-0 transparent">
        <v-list-item-group v-model="selectedToken" mandatory>
          <v-list-item
            v-for="(item, index) in filteredTokens"
            :key="index"
            :value="item"
            @click="onChange"
          >
            <v-list-item-action>
              <v-badge
                overlap
                avatar
                color="transparent"
                :offset-y="45"
                v-if="item['verified']"
              >
                <template v-slot:badge>
                  <v-avatar color="transparent" tile >
                    <v-icon small color="primary">
                      mdi-check-decagram
                    </v-icon>
                  </v-avatar>
                </template>
                <v-avatar size="40">
                  <img
                    :src="item['img']"
                    :alt="`${item['ticker']} Logo`"
                  />
                </v-avatar>
              </v-badge>
              <v-avatar size="40" v-else>
                <img
                  :src="item['img']"
                  :alt="`${item['ticker']} Logo`"
                />
              </v-avatar>
            </v-list-item-action>
            <v-list-item-content>
              <v-list-item-title>
                {{ item['name'] }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ item['ticker'] }}
              </v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-content class="text-right" v-if="item['balance']">
              <v-list-item-title>
                {{ item['balance'] | toCurrency(false, 0, '', ' ' + item['ticker'], false, item['decimals']) }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ item['balance'] }}
              </v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-action>
              <v-btn
                icon
                @click.stop="toggleFavoriteToken(item)"
                v-if="item['unit']"
              >
                <v-icon>{{ favoriteTokens.includes(item['unit']) ? 'mdi-star' : 'mdi-star-outline' }}</v-icon>
              </v-btn>
            </v-list-item-action>
          </v-list-item>
        </v-list-item-group>
      </v-list>
    </v-card-text>
  </BaseDialog>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import BaseDialog from '@/shared/components/BaseDialog.vue';
import { mapActions, mapState } from 'pinia';
import { useStore } from '@/store';
import filters from '@/shared/utils/filters';
import debounce from 'lodash/debounce';

export default defineComponent({
  name: 'SelectTokenDialog',
  components: { BaseDialog },
  props: {
    value: {
      type: Object,
    },
    isOpen: {
      type: Boolean,
      default: false,
    },
    availableTokens: {
      type: Array,
    },
  },
  filters,
  data() {
    return {
      search: '',
    };
  },
  computed: {
    ...mapState(useStore, ['price', 'pinnedTokens']),
    debouncedSearch() {
      return debounce(this.performSearch, 300);
    },
    favoriteTokens() {
      return this.pinnedTokens.filter(unit =>
        this.availableTokens.some(token => token['unit'] === unit)
      );
    },
    selectedToken: {
      get() {
        return this.value;
      },
      set(newToken) {
        if (newToken && this.availableTokens.length > 0) {
          this.$emit('input', newToken);
        }
      },
    },
    filteredTokens() {
      const lowerCaseSearch = this.search.toLowerCase();
      return this.availableTokens.filter(
        token =>
          token['name'].toLowerCase().includes(lowerCaseSearch) ||
          token['ticker'].toLowerCase().includes(lowerCaseSearch) ||
          token['unit'].toLowerCase().includes(lowerCaseSearch)
      );
    },
  },
  methods: {
    ...mapActions(useStore, ['toggleFavoriteToken']),
    onSearchInput() {
      this.debouncedSearch();
    },
    performSearch() {
      this.filteredTokens; // Trigger filtering
    },
    onChange() {
      this.$emit('close');
    },
    resolveToken(unit) {
      return this.availableTokens.find(token => token['unit'] === unit);
    },
  },
  unmounted() {
    this.debouncedSearch.cancel();
  },
});
</script>

<style scoped>
/* Add any scoped styles here */
</style>
