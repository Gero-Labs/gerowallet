<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Receive" subtitle="Receive ADA by displaying your wallet address and QR code.">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <v-list-item three-line class="px-0">
        <v-list-item-avatar size="160" rounded>
          <div id="qr-code" ref="qrCode" style="border-radius: 8px"> </div>
        </v-list-item-avatar>
        <v-list-item-content style="align-self: normal;">
          <v-list-item-title style="max-width: -webkit-fill-available; font-size: 20px; display: inline-block; font-weight: bold; color: white;flex: 1 1 100%; overflow: visible; text-overflow: unset; white-space: normal; text-align: left;">
            {{options.data}}<copy-button small :value="baseAddress"></copy-button>
          </v-list-item-title>
          <v-list-item-subtitle style="text-align: left; font-size: 16px">
            Your wallet address
          </v-list-item-subtitle>
          <v-list-item-title style="max-width: -webkit-fill-available; font-size: 18px; display: inline-block; color: white;flex: 1 1 100%; overflow: visible; text-overflow: unset; white-space: normal; text-align: left;">
            Share this wallet address to receive payments. To protect privacy, new addresses are generated automatically once you use them.
          </v-list-item-title>
          <!--        <v-list-item-title class="pt-2">-->
          <!--          <v-btn color="primary">Generate new Address</v-btn>-->
          <!--        </v-list-item-title>-->
        </v-list-item-content>
      </v-list-item>
      <v-card-title class="px-0 pb-0">Used Addresses
        <!--      <v-spacer></v-spacer>-->
        <!--      <v-switch v-model="showUsed" label="Show Used" inset dense></v-switch>-->
      </v-card-title>
      <v-data-table :headers="[{text: 'Address', sortable: true, align: 'left', value: 'address'},]" :items="allAddresses" hide-default-footer hide-default-header>
        <template v-slot:[`item.address`]="{ item }">
          {{ item.address | shortenStringWithEllipsis(40)  }}<copy-button small :value="item.address"></copy-button>
        </template>
      </v-data-table>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import QRCodeStyling from 'qr-code-styling';
import Vue from 'vue';
import { mapState } from 'pinia';
import { useStore } from '@/store';
import CopyButton from '@/shared/components/CopyButton.vue';
import BaseDialog from '@/shared/components/BaseDialog.vue';
import filters from '@/shared/utils/filters';

export default {
  name: 'ReceiveDialog',
  components: { CopyButton, BaseDialog },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  filters,
  computed: {
    ...mapState(useStore, ['baseAddress', 'addresses', 'stakeAddress']),
    allAddresses() {
      if (this.showUsed) {
        console.log('used')
        return this.addresses
          .filter(address => address !== this.baseAddress)
          .map(address => {
          return {address, used: true}
        })
      }
      return []
    },
    options() {
      return {
        width: 160,
        height: 160,
        type: 'svg',
        data: this.baseAddress,
        image: require('@/assets/img/bkp/logo48.png'),
        margin: 2,
        qrOptions: {
          typeNumber: 0,
          mode: 'Byte',
          errorCorrectionLevel: 'Q',
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
            colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }],
          },
          type: 'rounded',
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
            colorStops: [{ offset: 0, color: '#00c7f3' }, { offset: 1, color: '#00ffd1' }],
          },
        },
      };
    },
  },
  methods: {
    download() {
      this.qrCode.download({ extension: this.extension });
    },
  },
  data: () => ({
    showUsed: true,
    qrCode: undefined,
    extension: 'svg',
  }),
  mounted() {
    this.qrCode = new QRCodeStyling(this.options);
    Vue.nextTick(() => {
      this.qrCode.append(this.$refs.qrCode);
    });
    this.extension = 'svg';
  },
  watch: {
    isOpen(val) {
      if (val) {
        Vue.nextTick(() => {
          this.qrCode.append(this.$refs.qrCode);
        });
      }
    },
  },
};
</script>
<style>
.dialogStyle {
  -webkit-backdrop-filter: blur(12px) brightness(0.2);
  backdrop-filter: blur(12px);
  background: #000000ab;
  border: solid 2px #ffffff44;
}
</style>
