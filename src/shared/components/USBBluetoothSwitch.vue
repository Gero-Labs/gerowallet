<template>
  <div class="usb-bluetooth-switch">
    <p class="my-auto text-right" style="width: 85px">
      USB
      <v-icon :color="value ? '#ffffff' : 'primary'" small>
        mdi-usb
      </v-icon>
    </p>
    <v-switch
      inset
      dense
      :value="value"
      @change="toggleSwitch"
      color="inherit"
      hide-details
      style="margin-top: 0; align-items: center;"
      class="usbBluetoothSwitch"
    ></v-switch>
    <p class="my-auto" style="width: 85px">
      <v-icon :color="value ? 'primary' : '#ffffff'" small>
        mdi-bluetooth
      </v-icon>
      Bluetooth
    </p>
  </div>
</template>

<script>
export default {
  name: 'USBBluetoothSwitch',
  props: {
    value: {
      type: Boolean,
      required: true,
    },
  },
  methods: {
    toggleSwitch(value) {
      if (!value) {
        this.$emit('input', false);
      } else {
        this.$emit('input', true);
      }
    },
  },
};
</script>

<style>
.usbBluetoothSwitch .v-input--selection-controls__input {
  margin-left: 16px!important;
}
.usb-bluetooth-switch {
  display: flex;
  align-items: center;
  place-content: center;
}

.usbBluetoothSwitch .v-input--switch__track {
  color: #ffffff2b !important;
  opacity: 1;
  border: 1px solid #ffffff12;
}

.usbBluetoothSwitch .v-input--switch__thumb {
  color: #2f9cac!important;
}
</style>
