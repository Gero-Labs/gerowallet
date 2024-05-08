<template>
  <BaseDialog :isOpen="dialogLocal" @close="dialogLocal = false">
    <v-card-title>Receive
      <v-spacer></v-spacer>
    </v-card-title>
    <v-card-subtitle>Receive ADA by displaying your wallet address and QR code.</v-card-subtitle>
    <v-card-text style="height:600px; align-content: center;" class="justify-center text-center">
        <div style="font-size:24px; color: white; width: 335px; margin: auto;" class="text-center pb-3">Use this wallet address to receive assets / collectibles</div>
        <div id="qr-code" ref="qrCode" style="border-radius: 8px"> </div>
        <span class="pt-3" style="width:554px; font-size: 16px; display: inline-block; font-weight: bold; color: white">{{options.data}}<copy-button small :value="walletAddress"></copy-button></span>
        {{stakeAddress}}
      </v-card-text>
    </BaseDialog>
</template>
<script>
import QRCodeStyling from "qr-code-styling";
import Vue from "vue";
import {mapState} from "pinia";
import {useStore} from "@/store";
import CopyButton from "@/shared/components/CopyButton.vue";
import BaseDialog from "@/shared/components/BaseDialog.vue";

export default {
  name: "ReceiveDialog",
  components: {CopyButton, BaseDialog},
  props: {
    dialog: {
      type: Boolean,
      default: false,
    },
  },
  watch: {
    dialog(val) {
      if (val) {
        Vue.nextTick(() => {
          this.qrCode.append(this.$refs.qrCode);
        })
      }
    }
  },
  computed: {
    ...mapState(useStore, ['wallets', 'loggedWallet']),
    walletAddress() {
      return this.store.getWallet.wallet.baseAddress().to_address().to_bech32()
    },
    stakeAddress() {
      return this.store.getWallet.wallet.stakeAddress().to_address().to_bech32()
    },
    dialogLocal: {
      get() {
        return this.dialog
      },
      set(value) {
        this.$emit('dialogChange', value)
      },
    },
    options() {
      return {
        width: 300,
        height: 300,
        type: 'svg',
        data: this.walletAddress,
        image: '/assets/img/logo128.png',
        margin: 2,
        qrOptions: {
          typeNumber: 0,
          mode: 'Byte',
          errorCorrectionLevel: 'Q'
        },
        imageOptions: {
          hideBackgroundDots: true,
          imageSize: 0.4,
          margin: 10,
          crossOrigin: 'anonymous',
        },
        dotsOptions: {
          // color: '#41b583',
          gradient: {
            type: 'linear', // 'radial'
            rotation: 0,
            colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }]
          },
          type: 'rounded'
        },
        backgroundOptions: {
          color: '#ffffff',
          // gradient: {
          //   type: 'linear', // 'radial'
          //   rotation: 0,
          //   colorStops: [{ offset: 0, color: '#ededff' }, { offset: 1, color: '#e6e7ff' }]
          // },
        },
        cornersSquareOptions: {
          color: '#35495E',
          type: 'extra-rounded',
          // gradient: {
          //   type: 'linear', // 'radial'
          //   rotation: 180,
          //   colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }]
          // },
        },
        cornersDotOptions: {
          // color: '#35495E',
          type: 'dot',
          gradient: {
            type: 'linear', // 'radial'
            rotation: 180,
            colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }]
          },
        }
      }
    }
  },
  methods: {
    download() {
      this.qrCode.download({ extension: this.extension })
    }
  },
  data: () => ({
    store: useStore(),
    qrCode: undefined,
    extension: 'svg',
  }),
  mounted() {
    this.qrCode = new QRCodeStyling(this.options)
    Vue.nextTick(() => {
      this.qrCode.append(this.$refs.qrCode);
    })
    this.extension = 'svg'

  }
}
</script>
<style>
.dialogStyle {
  -webkit-backdrop-filter: blur(12px) brightness(0.2);
  backdrop-filter: blur(12px);
  background: #000000ab;
  border: solid 2px #ffffff44;
}
</style>