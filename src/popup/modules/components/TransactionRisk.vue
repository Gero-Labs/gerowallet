<template>
  <div id="risk-wrap">
    <div id="risk-title">
      Transaction Risk
      <v-tooltip bottom>
        <template v-slot:activator="{ on, attrs }">
          <v-icon
            class="ml-1"
            small
            color="#C4C4C4"
            v-bind="attrs"
            v-on="on"
          >
            mdi-information-outline
          </v-icon>
        </template>
        <span>Cardano Shield provides<br>security insights on a<br><strong>best-effort</strong> basis.<br>
          Accuracy is not<br>guaranteed, and users<br>should exercise their<br>own caution.</span>
      </v-tooltip>
    </div>

    <div id="risk-indicator">
      <img id="risk-level" alt="Risk Level" :src="icon" />
      <div id="risk-loader" v-if="loading">
        <span class="custom-loader">
          <v-icon x-large>mdi-cog</v-icon>
        </span>
      </div>
      <div id="risk-label" v-else>{{ label }}</div>
    </div>
    <div id="risk-powered">
      <span>Powered by</span>
      <a href="https://cardanoshield.com/" target="_blank">
        <img alt="Cardano Shield" :src="require('@/assets/img/cardano-shield/logo.png')" style="height: 30px" />
      </a>
    </div>
  </div>
</template>
<script>
import { DappScore } from '@/models/cardano-shield-types';

export default {
  name: 'TransactionRisk',
  props: {
    risk: {
      type: String
    },
    loading: {
      type: Boolean,
    }
  },
  methods: {
    getIcon(risk) {
      switch (DappScore[risk]) {
        case DappScore.low:
          return 'risk-low.svg';
        case DappScore.medium:
          return 'risk-medium.svg';
        case DappScore.high:
          return 'risk-high.svg';
        default:
          return 'risk-unknown.svg';
      }
    },
    getLabel(risk) {
      switch (DappScore[risk]) {
        case DappScore.low:
          return 'LOW';
        case DappScore.medium:
          return 'MED';
        case DappScore.high:
          return 'HIGH';
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
  },
};
</script>
<style scoped>
#risk-wrap {
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: center;
  margin: 0 auto 0;
  width: 192px;
}
#risk-title {
  display: flex;
  align-items: center;
  margin-bottom: 2px;
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
  min-height: 113px;
  width: 192px;
}
#risk-level {
  top: 0;
  left: 0;
  right: 0;
  width: inherit;
  position: absolute;
}
#risk-loader {
  bottom: 20px;
  left: 76px;
  position: absolute;
}
#risk-label {
  bottom: 10px;
  width: inherit;
  position: absolute;
  text-align: center;
  font-family: Quicksand,serif;
  line-height: 36px;
  font-weight: 400;
  font-size: 36px;
}
#risk-powered {
  height: 36px;
  width: inherit;
  position: relative;
  display: flex;
  text-align: center;
  align-items: center;
  justify-content: center;
  span {
    font-size: 10px;
    line-height: 16px;
  }
  img {
    height: 16px;
    margin-left: 2px;
  }
}

.v-tooltip__content {
  background: rgba(15, 19, 21, 1);
  border:1px solid #C4C4C4;
  line-height: 18px;
  padding: 10px;
  font-size: 14px;
}
.v-tooltip__content.menuable__content__active {
  opacity: 1;
}
.custom-loader {
  animation: loader 1s infinite;
  display: flex;
}
@-moz-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(360deg);
  }
}
@-webkit-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(360deg);
  }
}
@-o-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(360deg);
  }
}
@keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
