import { defineStore } from 'pinia';
import { appWallet } from '@/store';
import { Blockchain, Network } from '@/models/types';
import { parseHttpError } from '@/shared/utils/parser';

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
    setPortfolio(portfolio: any) {
      this.portfolio = portfolio
    },
    setPortfolioTrendedValue(portfolioTrendedValue: any) {
      this.portfolioTrendedValue = portfolioTrendedValue
    },
    async loadPortfolio() {
      if (!appWallet || !(appWallet.network == Network.MAINNET && appWallet.chain == Blockchain.CARDANO)) {
        return
      }
      try {
        const res = await appWallet.api.getPortfolio(appWallet.stakeAddress().toBech32())
        if (res?.status == 200) {
          this.setPortfolio(res.data)
        } else {
          console.log(parseHttpError(res))
        }
      } catch (e) {
        console.error(e);
      }
    },
    async loadPortfolioTrendedValue() {
      if (!appWallet || !(appWallet.network == Network.MAINNET && appWallet.chain == Blockchain.CARDANO)) {
        return
      }
      try {
        const res = await appWallet.api.getPortfolioTrendedValue(appWallet.stakeAddress().toBech32());
        this.setPortfolioTrendedValue(res.map(element => [element.time * 1000, element.value]))
      } catch (e) {
        console.error(e);
      }
    }
  }
});
