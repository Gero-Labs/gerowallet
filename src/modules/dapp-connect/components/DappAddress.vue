<template>
  <div
    v-if="address"
    id="dapp-receiver-wrap"
    :class="{
      suspicious: risk == DappRisk.Suspicious,
      blacklist: risk == DappRisk.Blacklist,
      whitelist: risk == DappRisk.Whitelist,
    }"
  >
    <div id="dapp-receiver-header">
      <div id="dapp-receiver-label">To address</div>
      <img
        alt="Hint"
        width="12"
        height="12"
        :src="require('@/assets/svg/hint.svg')"
        v-tooltip.bottom="tooltipContent"
      />
    </div>

    <div id="dapp-receiver-details">
      <img id="dapp-receiver-check" alt="Trusted Address" height="18" width="16" :src="icon" />

      <div id="dapp-receiver-address">{{ address }}</div>
    </div>
  </div>
</template>

<!------------------------------------------------------------------------------ Script -->

<script>
import { DappRisk } from '@/models/dapp/statuses.enum';
import TooltipAddress from './tooltips/TooltipAddress.ts';

export default {
  data() {
    return {
      DappRisk,
    };
  },
  props: {
    address: {
      type: String,
    },
    risk: {
      type: Number,
      default: DappRisk.Unknown,
    },
  },
  methods: {
    getIcon(risk) {
      switch (risk) {
        case DappRisk.Whitelist:
          return 'dapp-safe.png';
        case DappRisk.Blacklist:
          return 'dapp-phishing.png';
        case DappRisk.Suspicious:
          return 'dapp-suspicious.png';
        case DappRisk.Unknown:
        default:
          return 'dapp-unknown.png';
      }
    },
  },
  computed: {
    icon() {
      return require(`@/assets/img/cardano-shield/${this.getIcon(this.risk)}`);
    },
    tooltipContent() {
      return {
        html: true,
        content: TooltipAddress(),
      };
    },
  },
};
</script>

<!------------------------------------------------------------------------------ Styles -->

<style scoped>
#dapp-receiver-wrap {
  padding: 8px 10px;
  background: linear-gradient(270deg, #1f1f1f -61.94%, #4b4b4b 115%);
}

#dapp-receiver-header {
  display: flex;
  margin-bottom: 6px;
  align-items: center;
  flex-direction: row;
  justify-content: space-between;
}

#dapp-receiver-label {
  color: white;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
}

#dapp-receiver-details {
  display: flex;
  flex-direction: row;
}

#dapp-receiver-check {
  margin: 2px 6px 2px 0;
}

#dapp-receiver-address {
  color: white;
  font-size: 10px;
  font-weight: 400;
  line-height: 12px;
  word-wrap: break-word;
  word-break: break-all;
}

#dapp-receiver-wrap.suspicious {
  background: linear-gradient(269.92deg, #552900 1.73%, #915a28 97.85%);
}

#dapp-receiver-wrap.blacklist {
  background: linear-gradient(269.92deg, #250303 1.73%, #5d0101 97.85%);
}

#dapp-receiver-wrap.whitelist {
  background: linear-gradient(91.2deg, #00615b 40.76%, #00221c 103.06%);
}
</style>
