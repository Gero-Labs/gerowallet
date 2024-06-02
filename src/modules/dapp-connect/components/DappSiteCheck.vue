<template>
  <div v-if="website" id="dapp-check">
    <div id="dapp-check-text">
      Website: <span>{{ website }}</span>
    </div>
    <img id="dapp-check-icon" alt="Dapp Check" :src="icon" />
  </div>
</template>

<!------------------------------------------------------------------------------ Script -->

<script>
import { DappRisk } from '@/models/dapp/statuses.enum';

export default {
  data() {
    return {
      risk: DappRisk.Unknown,
    };
  },
  props: {
    website: {
      type: String,
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
        case DappRisk.Timeout:
          return 'dapp-timeout.png';
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
  },
  async mounted() {
    // TODO: Fetch the risk from the Cardano Shield API.
    this.risk = DappRisk.Whitelist;
  },
};
</script>

<!------------------------------------------------------------------------------ Styles -->

<style scoped>
#dapp-check {
  display: flex;
  margin: 0 auto;
  color: #c4c4c4;
  align-items: center;
  flex-direction: row;
  justify-content: center;
}

#dapp-check-text > span {
  color: white;
}

#dapp-check-icon {
  margin-left: 6px;
  height: 12px;
}
</style>
