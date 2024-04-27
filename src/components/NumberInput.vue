<template>
  <v-card rounded outlined>
    <v-card-text style="display: flex;" class="pb-0">
      Input
      <v-spacer></v-spacer>
      Balance: {{ maxQuantity }}
    </v-card-text>
    <v-card-text class="py-1">
      <v-row
          justify="space-between"
      >
        <v-col class="text-left">
          <span
              class="text-h4 font-weight-light"
              v-text="count"
          ></span>
        </v-col>
        <v-col class="text-right">
          <v-chip pill>
            <v-avatar left>
              <img src="https://d1zjrpdfxjmowk.cloudfront.net/assets/images/forge%20token-small.webp" alt="forge">
            </v-avatar>
            &nbsp;FORGE
          </v-chip>
        </v-col>
      </v-row>
      <v-slider
          v-model="count"
          track-color="grey"
          always-dirty
          min="1"
          :max="max"
      >
        <template v-slot:prepend>
          <v-icon
              @click="decrement"
          >
            mdi-minus
          </v-icon>
        </template>

        <template v-slot:append>
          <v-icon
              @click="increment"
          >
            mdi-plus
          </v-icon>
        </template>
      </v-slider>
    </v-card-text>
  </v-card>
</template>
<script>
export default {
  props: {
    value: {
      type: Number,
      required: true,
    },
    max: {
      type: Number,
      required: false,
      default: 0,
    },
  },
  computed: {
    quantityRules() {
      return [
        v => (v && v >= 1) || 'Quantity Should be Above 1',
        v => (v && v <= this.maxQuantity) || 'Max Quantity Cannot be Above '+this.maxQuantity,
      ]
    },
  },
  data() {
    return {
      count: 0,
      maxQuantity: 0,
    }
  },
  watch: {
    value(val) {
      this.count = val
    },
    max(val) {
      this.maxQuantity = val
    },
    count(val) {
      this.$emit('updateQuantity', val)
    },
  },
  mounted() {
    this.count = this.value
    this.maxQuantity = this.max
  },
  methods: {
    decrement() {
      if (this.count > 1) {
        this.count--
        this.$emit('updateQuantity', this.count)
      }
    },
    increment() {
      if (this.count < this.max) {
        this.count++
        this.$emit('updateQuantity', this.count)
      }
    },
  },
}
</script>
<style scoped>
.v-text-field.v-text-field--enclosed .v-text-field__details, .v-text-field.v-text-field--enclosed:not(.v-text-field--rounded)>.v-input__control>.v-input__slot {
  padding: 0!important;
}
.v-text-field.v-text-field--solo:not(.v-text-field--solo-flat)>.v-input__control>.v-input__slot {
  box-shadow: none!important;
}
.large-input >>> input {
  font-size: 22px;
  font-weight: 500;
  padding: 0;
}
.v-text-field--outlined .v-input__prepend-outer, .v-text-field--outlined .v-input__append-outer {
  margin-top: 9px!important;
}
.v-application--is-ltr .v-input__prepend-outer {
  margin-right: 4px!important;
}
.v-application--is-ltr .v-input__append-outer {
  margin-left: 4px!important;
}
</style>