<template>
  <div id="dapp-host">
    <div id="dapp-modal">
      <section id="modal-header">
        <v-img contain alt="Gero Logo" id="modal-logo-icon" :src="require('@/assets/img/logo48.png')"></v-img>

        <v-img contain alt="Gero Logo" id="modal-logo-text" :src="require('@/assets/svg/gero-text.svg')"></v-img>

        <h1 id="modal-title" v-html="title"></h1>
      </section>

      <section id="modal-site-check">
        <DappSiteCheck :website="website" />
      </section>

      <main id="modal-content">
        <slot />
      </main>
    </div>
  </div>
</template>

<!------------------------------------------------------------------------------ Script -->

<script>
import DappSiteCheck from './DappSiteCheck.vue';

export default {
  components: { DappSiteCheck },
  props: {
    title: {
      type: String,
      default: '',
    },
    website: {
      type: String,
      default: '',
    },
  },
};
</script>

<!------------------------------------------------------------------------------ Styles -->

<style scoped>
#dapp-host {
  position: fixed;
  overflow: auto;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 500px;
  max-height: 770px;
  box-sizing: border-box;
  background: #000000e5;
  border: 2px solid #00dff3;
  background-image: url(@/assets/bg-dapp.png);
}

#dapp-modal {
  width: 100%;
  min-height: 100%;
  padding: 24px 32px;
  backdrop-filter: brightness(25%);
  flex-direction: column;
  display: flex;
}

#modal-header {
  display: flex;
  margin-bottom: 24px;
  flex-direction: column;
}

#modal-logo-icon {
  margin: 0 auto 6px;
  height: 48px;
  width: 48px;
}

#modal-logo-text {
  margin: 0 auto 12px;
  width: 48px;
}

#modal-title {
  display: block;
  font-size: 20px;
  font-weight: 700;
  line-height: 28px;
  text-align: center;
  flex-direction: column;
}

#modal-site-check {
  margin-bottom: 12px;
}

#modal-content {
  flex: auto;
  display: flex;
  position: relative;
  flex-direction: column;
}
</style>
