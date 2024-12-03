import { defineStore } from 'pinia';
import { appWallet } from '@/store';

export const tapToolsStore = defineStore( 'tapToolsStore', {
  persist: {
    paths: ['portfolio', 'portfolioTrendedValue']
  },
  state: () => ({
    portfolio: undefined,
    portfolioTrendedValue: undefined
  }),
  getters: {
    getNativeTokenStats(state) {
      if (state?.portfolio) {
        return state.portfolio
      }
      return undefined
    },
  },
  actions: {
    async loadPortfolio() {
      if (!appWallet) {
        return
      }
      try {
        this.portfolio = await appWallet.api.getPortfolio(appWallet.stakeAddress().to_address().to_bech32());
        console.log(this.portfolio)
      } catch (e) {
        console.error(e);
      }
    },
    async loadPortfolioTrendedValue() {
      if (!appWallet) {
        return
      }
      try {
        const res = await appWallet.api.getPortfolioTrendedValue(appWallet.stakeAddress().to_address().to_bech32());
        this.portfolioTrendedValue = res.map(element => [element.time * 1000, element.value])
        console.log(this.portfolioTrendedValue)
      } catch (e) {
        console.error(e);
      }
    }
  }
});
