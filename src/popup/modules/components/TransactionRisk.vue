<template>
  <div id="risk-wrap">
    <div id="risk-title">
      {{ $t('security.transactionRisk') }}
      <v-tooltip bottom content-class="custom-tooltip">
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
        <span>{{ $t('security.cardanoShieldNote') }}</span>
      </v-tooltip>
    </div>

    <div id="risk-indicator">
      <img id="risk-level" :alt="t('common.riskLevel')" :src="icon" style="height: 86px" />

      <div id="risk-loader" v-if="loading">
        <span class="custom-loader">
          <v-icon x-large>mdi-cog</v-icon>
        </span>
      </div>
      <div id="risk-label" v-else>{{ label }}</div>
    </div>
    <div id="risk-powered">
      <span>{{ $t('security.poweredBy') }}</span>
      <a href="https://cardanoshield.com/" target="_blank">
        <img :alt="t('common.cardanoShield')" :src="assets.cardanoShieldBigLogo" style="height: 30px" />
      </a>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed } from 'vue';
import { DappScore } from '@/models/cardano-shield-types';
import assets from '@/utils/assets';

const { t } = useTranslation();

const props = defineProps({
  risk: {
    type: String
  },
  loading: {
    type: Boolean,
    default: false
  }
});

// Debug logging
console.log('TransactionRisk loading prop:', props.loading);

const getLabel = (risk: string | undefined) => {
  if (!risk) return t('common.na');
  switch (DappScore[risk as keyof typeof DappScore]) {
    case DappScore.low:
      return t('common.low');
    case DappScore.medium:
      return t('common.medium');
    case DappScore.high:
      return t('common.high');
    default:
      return t('common.na');
  }
};

const icon = computed(() => {
  return assets.resolveCardanoShieldRisk(props.risk);
});

const label = computed(() => {
  return getLabel(props.risk);
});
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
  min-height: 86px;
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
  bottom: 0;
  left: 76px;
  position: absolute;
}
#risk-label {
  bottom: 0;
  width: inherit;
  position: absolute;
  text-align: center;
  font-family: Quicksand,serif;
  line-height: 36px;
  font-weight: 400;
  font-size: 24px;
}
#risk-powered {
  height: 36px;
  width: inherit;
  position: relative;
  display: flex;
  text-align: center;
  align-items: center;
  justify-content: center;
  :is(span) {
    font-size: 10px;
    line-height: 16px;
  }
  :is(img) {
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
