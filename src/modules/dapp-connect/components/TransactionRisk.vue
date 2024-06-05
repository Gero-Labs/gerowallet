<template>
  <div id="risk-wrap">
    <div id="risk-title">
      Transaction Risk
      <img
        alt="Hint"
        height="12"
        width="12"
        :src="require('@/assets/svg/hint.svg')"
        v-tooltip.bottom="tooltipContent"
      />
    </div>

    <div id="risk-indicator">
      <img id="risk-level" alt="Risk Level" :src="icon" />
      <div id="risk-label">{{ label }}</div>
      <div id="risk-powered">
        <span>Powered by</span>
        <img alt="Cardano Shield" :src="require('@/assets/img/cardano-shield/logo.png')" />
      </div>
    </div>
  </div>
</template>

<!------------------------------------------------------------------------------ Script -->

<script>
import { DappScore } from '@/models/dapp/statuses.enum';

import TooltipCardanoShield from './tooltips/TooltipCardanoShield';

export default {
  props: {
    risk: {
      type: Number,
      default: DappScore.Unknown,
    },
  },
  methods: {
    getIcon(risk) {
      switch (risk) {
        case DappScore.Low:
          return 'risk-low.svg';
        case DappScore.Medium:
          return 'risk-medium.svg';
        case DappScore.High:
          return 'risk-high.svg';
        case DappScore.Unknown:
        default:
          return 'risk-unknown.svg';
      }
    },
    getLabel(risk) {
      switch (risk) {
        case DappScore.Low:
          return 'LOW';
        case DappScore.Medium:
          return 'MED';
        case DappScore.High:
          return 'HIGH';
        case DappScore.Unknown:
        default:
          return 'N/A';
      }
    },
  },
  computed: {
    icon() {
      return require(`@/assets/img/cardano-shield/${this.getIcon(this.risk)}`);
    },
    label() {
      return this.getLabel(this.risk);
    },
    tooltipContent() {
      return {
        html: true,
        content: TooltipCardanoShield(),
      };
    },
  },
};
</script>

<!------------------------------------------------------------------------------ Styles -->

<style scoped>
#risk-wrap {
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: center;
  margin: 0 auto 24px;
  width: 192px;
}

#risk-title {
  display: flex;
  align-items: center;
  margin-bottom: 16px;

  color: white;
  font-size: 14px;
  font-weight: 400;
  line-height: 21px;

  & > img {
    margin-left: 4px;
  }
}

#risk-indicator {
  position: relative;
  height: 120px;
  width: 192px;
}

#risk-level {
  top: 0;
  left: 0;
  right: 0;
  width: inherit;
  position: absolute;
}

#risk-label {
  bottom: 20px;
  width: inherit;
  position: absolute;
  text-align: center;
  font-family: Quicksand;
  line-height: 36px;
  font-weight: 400;
  font-size: 36px;
}

#risk-powered {
  bottom: 0;
  height: 16px;
  width: inherit;
  position: absolute;

  display: flex;
  text-align: center;
  align-items: center;
  justify-content: center;

  span {
    font-size: 11px;
    line-height: 16px;
  }

  img {
    height: 16px;
    margin-left: 2px;
  }
}
</style>
