<template>
  <footer id="dapp-footer">
    <slot />
  </footer>
</template>

<!------------------------------------------------------------------------------ Styles -->

<style scoped>
#dapp-footer {
  gap: 16px;
  display: grid;
  grid-auto-rows: minmax(40px, auto);
  grid-template-columns: repeat(2, 1fr);
}

>>> .v-text-field {
  border-radius: 10px;
  background: #0f0f0f;
  border: thin solid var(--v-primary-base);
}

>>> .v-input__control .v-input__slot {
  margin-bottom: 0;
}

>>> .v-input__control .v-text-field__details {
  display: none;
}
</style>
