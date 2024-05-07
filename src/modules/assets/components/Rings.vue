<template>
  <div class="rings-container">
    <div class="rings"></div>
    <div class="rings"></div>
    <div class="rings"></div>
    <div class="rings"></div>
  </div>
</template>

<script>
export default {
  name: "Rings",
};
</script>

<style scoped>
.rings-container {
  position: absolute;
  top: -7px;
  left: -7px;
  width: 150px;
  height: 150px;
  display: flex;
  justify-content: center;
  align-items: center;

  .rings {
    border: 1px solid #1d212a;
    border-radius: 50%;
    position: absolute;

    &:first-child {
      width: 90px;
      height: 90px;
      opacity: 0.8;
    }

    &:nth-child(2) {
      width: 120px;
      height: 120px;
      opacity: 0.6;
    }

    &:nth-child(3) {
      width: 150px;
      height: 150px;
      opacity: 0.4;
    }

    &:last-child {
      width: 180px;
      height: 180px;
      opacity: 0.2;
    }
  }
}
</style>
