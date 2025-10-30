import networks from '@/utils/networks';
import i18n from '@/plugins/i18n';

export interface EmptyStateConfig {
  icon: string;
  title: string;
  description: string;
  primaryAction?: {
    label: string;
    icon: string;
    action: string;
  };
  secondaryAction?: {
    label: string;
    action: string;
  };
}

export const getEmptyStateConfig = (
  component: string,
  chain?: string,
  network?: string
): EmptyStateConfig => {
  const currencySymbol = networks.resolveCurrencySymbol(chain, network);
  const currencyTicker = networks.resolveCurrencyTicker(chain, network);
  const configs: Record<string, EmptyStateConfig> = {
    portfolio: {
      icon: 'mdi-chart-line',
      title: i18n.t('emptyState.noPortfolioData') as string,
      description: i18n.t('emptyState.portfolioDescription', { currency: currencySymbol }) as string,
      primaryAction: {
        label: i18n.t('emptyState.getCurrency', { currency: currencySymbol }) as string,
        icon: 'mdi-plus',
        action: 'get-tokens'
      }
    },

    transactions: {
      icon: 'mdi-swap-horizontal-circle-outline',
      title: i18n.t('emptyState.noTransactions') as string,
      description: i18n.t('emptyState.transactionsDescription') as string,
      primaryAction: {
        label: i18n.t('emptyState.makeFirstTransaction') as string,
        icon: 'mdi-send',
        action: 'send-tokens'
      },
      secondaryAction: {
        label: i18n.t('emptyState.receiveTokens') as string,
        action: 'receive-tokens'
      }
    },

    tokens: {
      icon: 'mdi-coins',
      title: i18n.t('emptyState.noTokens') as string,
      description: i18n.t('emptyState.tokensDescription', { currency: currencySymbol, chain }) as string,
      primaryAction: {
        label: i18n.t('emptyState.buyCurrency', { currency: currencySymbol }) as string,
        icon: 'mdi-credit-card',
        action: 'buy-crypto'
      },
      secondaryAction: {
        label: i18n.t('emptyState.receiveCurrency', { currency: currencySymbol }) as string,
        action: 'receive-tokens'
      }
    },

    staking: {
      icon: 'mdi-cash-clock',
      title: i18n.t('dashboard.readyToEarnRewards') as string,
      description: i18n.t('dashboard.addToStartStaking', { currency: currencySymbol }) as string,
      primaryAction: {
        label: i18n.t('dashboard.getCurrencyToStake', { currency: currencySymbol }) as string,
        icon: 'mdi-plus',
        action: 'get-tokens-for-staking'
      },
      secondaryAction: {
        label: i18n.t('dashboard.learnAboutStaking') as string,
        action: 'learn-staking'
      }
    },

    swap: {
      icon: 'mdi-swap-horizontal',
      title: i18n.t('dashboard.tokenSwapping') as string,
      description: i18n.t('dashboard.getFirstThenSwap', { currency: currencySymbol }) as string,
      primaryAction: {
        label: i18n.t('dashboard.getCurrency', { currency: currencySymbol }) as string,
        icon: 'mdi-plus',
        action: 'get-tokens-first'
      },
      secondaryAction: {
        label: i18n.t('dashboard.learnAboutDexs') as string,
        action: 'learn-dex'
      }
    },

    nfts: {
      icon: 'mdi-image-multiple-outline',
      title: i18n.t('dashboard.noNftsYet') as string,
      description: i18n.t('dashboard.nftCollectionAppearHere') as string,
      primaryAction: {
        label: i18n.t('dashboard.exploreNftMarketplaces') as string,
        icon: 'mdi-store',
        action: 'explore-nfts'
      }
    },

    defi: {
      icon: 'mdi-finance',
      title: i18n.t('dashboard.defiOpportunitiesAwait') as string,
      description: i18n.t('dashboard.addToExploreDeFi', { currency: currencySymbol }) as string,
      primaryAction: {
        label: i18n.t('dashboard.getStarted') as string,
        icon: 'mdi-rocket-launch',
        action: 'explore-defi'
      }
    },

    cashback: {
      icon: 'mdi-cash-refund',
      title: i18n.t('dashboard.cashbackReady') as string,
      description: i18n.t('dashboard.shopEarnCashback', { currency: currencySymbol }) as string,
      primaryAction: {
        label: i18n.t('dashboard.browseDeals') as string,
        icon: 'mdi-tag-multiple',
        action: 'browse-cashback'
      }
    },

    // Specific empty state for pie chart
    pieChart: {
      icon: 'mdi-chart-pie',
      title: i18n.t('dashboard.tokenDistribution') as string,
      description: i18n.t('dashboard.tokenAllocationDisplayed') as string,
      primaryAction: {
        label: i18n.t('dashboard.addTokens') as string,
        icon: 'mdi-plus',
        action: 'add-tokens'
      }
    },

    // Market data when no tokens
    marketData: {
      icon: 'mdi-trending-up',
      title: i18n.t('dashboard.marketOverview') as string,
      description: i18n.t('dashboard.trackPriceAndTrends', { currency: currencyTicker }) as string,
      primaryAction: {
        label: i18n.t('dashboard.buyCurrency', { currency: currencySymbol }) as string,
        icon: 'mdi-credit-card',
        action: 'buy-crypto'
      }
    }
  };

  return configs[component] || {
    icon: 'mdi-information-outline',
    title: i18n.t('emptyState.noData') as string,
    description: i18n.t('emptyState.noDataDescription') as string,
  };
};

// Helper to determine if wallet has any activity
export const isWalletEmpty = (account: any, tokens: any): boolean => {
  const hasNativeTokens = account?.controlled_amount > 0;
  const hasOtherTokens = tokens && Object.keys(tokens).length > 1; // More than just native token
  return !hasNativeTokens && !hasOtherTokens;
};

// Helper to determine if user is completely new
export const isNewUser = (transactions: any[], account: any): boolean => {
  return (!transactions || transactions.length === 0) &&
         (!account || !account.active);
};

// Get contextual help tips based on empty state
export const getHelpTips = (component: string, isNew: boolean): string[] => {
  if (isNew) {
    return [
      i18n.t('dashboard.walletAddressTip') as string,
      i18n.t('dashboard.seedPhraseSafeTip') as string,
      i18n.t('dashboard.startSmallAmountTip') as string,
      i18n.t('dashboard.joinCommunityTip') as string
    ];
  }

  const tips: Record<string, string[]> = {
    portfolio: [
      i18n.t('dashboard.portfolioTracksTip') as string,
      i18n.t('dashboard.viewMultipleCurrenciesTip') as string,
      i18n.t('dashboard.historicalDataTip') as string
    ],
    staking: [
      i18n.t('dashboard.stakingRewardsTip') as string,
      i18n.t('dashboard.chooseStakePoolTip') as string,
      i18n.t('dashboard.tokensRemainControlTip') as string
    ],
    swap: [
      i18n.t('dashboard.swapDirectlyTip') as string,
      i18n.t('dashboard.compareRatesTip') as string,
      i18n.t('dashboard.slippageToleranceTip') as string
    ]
  };

  return tips[component] || [];
};
