<template>
  <v-btn :icon="!!!title" :text="!!title" :x-small="xSmall" :small="small" :large="large" :x-large="xLarge" :color="colorB" @click.stop="copy" :style="xSmall && !title ? { width: '16px', height: '16px', marginTop: '0px'} : {}">
    <span v-if="title" class="mr-1">{{title}}</span>
    <v-icon :x-small="xSmall" :small="small" :large="large" :x-large="xLarge">
      {{ icon }}
    </v-icon>
  </v-btn>
</template>
<script>
export default {
  name: 'CopyButton',
  props: {
    value: {
      type: String,
      required: true,
    },
    xSmall: {
      type: Boolean,
      required: false,
      default: false,
    },
    small: {
      type: Boolean,
      required: false,
      default: false,
    },
    large: {
      type: Boolean,
      required: false,
      default: false,
    },
    xLarge: {
      type: Boolean,
      required: false,
      default: false,
    },
    color: {
      type: String,
      required: false,
    },
    title: {
      type: String,
      required: false,
    }
  },
  data() {
    return {
      icon: 'mdi-content-copy',
      colorB: undefined,
    }
  },
  methods: {
    async copy() {
      await navigator.clipboard.writeText(this.value)
      this.icon = 'mdi-check'
      this.colorB = 'green'
      setTimeout(() => {
        this.icon = 'mdi-content-copy'
        this.colorB = this.color
      }, 1000)
    },
  },
  mounted() {
    if (this.color) {
      this.colorB = this.color
    }
  },
}
</script>
<style scoped>

</style>
