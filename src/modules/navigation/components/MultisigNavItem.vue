<template>
  <div class="multisig-nav-item" :class="{ active: isActive }" @click="navigate">
    <img src="@/assets/svg/users-plus.svg" alt="Multisig" class="nav-icon" />
    <span class="nav-text">Multisig Transactions</span>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component
export default class MultisigNavItem extends Vue {
  @Prop({ type: Boolean, default: false }) isActive!: boolean;

  navigate() {
    this.$router.push('/multisig');
  }
}
</script>

<style scoped>
.multisig-nav-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  gap: 12px;
  border-radius: 6px;
  color: #cecfd2;
  font-family: 'Inter', sans-serif;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  padding-left: 26px;
}

.multisig-nav-item.active {
  color: #f5f5f5;
  border: 1px solid #0c0e12;
  background-color: #0c0e12;
}

.nav-text {
  flex: 1;
}

.nav-icon {
  width: 24px;
  height: 24px;
}
</style>
