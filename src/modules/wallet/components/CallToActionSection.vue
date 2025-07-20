<template>
  <section class="call-to-action-section">
    <div class="new-tag">New</div>
    <h2 class="cta-heading">Spend Crypto Anywhere, Instantly</h2>
    <p class="cta-description">
      Your digital assets, now swipe-ready. Use your crypto like cash—anywhere <br />
      Mastercard is accepted.
    </p>
    <GradientButton text="Order your card today" @click="openModal" />

    <OrderCardModal :open="showModal" @close="showModal = false" />
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import GradientButton from './GradientButton.vue';
import OrderCardModal from './OrderCardModal.vue';

const showModal = ref(false);

const openModal = () => {
  showModal.value = true;
};
</script>

<style scoped>
.call-to-action-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.new-tag {
  display: inline-block;
  background: #053321;
  color: #75E0A7;
  font-family: Inter, sans-serif;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.43;
  padding: 4px 12px;
  border-radius: 9999px;
  border: 1px solid #085D3A;
  margin-bottom: 24px;
  text-align: center;
}

.cta-heading {
  font-size: 36px;
  font-weight: 700;
  color: white;
  margin: 0 0 12px 0;
  line-height: 1.2;
}

.cta-description {
  font-size: 20px;
  color: #94979c;
  margin: 0 0 40px 0;
  line-height: 1.6;
  text-align: center;
}
</style>
