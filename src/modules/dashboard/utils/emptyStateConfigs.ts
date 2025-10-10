import networks from '@/utils/networks';

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
      title: 'No Portfolio Data Yet',
      description: `Add ${currencySymbol} to your wallet to see your portfolio chart and track your balance over time`,
      primaryAction: {
        label: `Get ${currencySymbol}`,
        icon: 'mdi-plus',
        action: 'get-tokens'
      }
    },

    transactions: {
      icon: 'mdi-swap-horizontal-circle-outline',
      title: 'No Transactions Yet',
      description: 'Your transaction history will appear here once you send or receive tokens',
      primaryAction: {
        label: 'Make First Transaction',
        icon: 'mdi-send',
        action: 'send-tokens'
      },
      secondaryAction: {
        label: 'Receive tokens',
        action: 'receive-tokens'
      }
    },

    tokens: {
      icon: 'mdi-coins',
      title: 'No Tokens Found',
      description: `Start by adding ${currencySymbol} to your wallet to begin your ${chain} journey`,
      primaryAction: {
        label: `Buy ${currencySymbol}`,
        icon: 'mdi-credit-card',
        action: 'buy-crypto'
      },
      secondaryAction: {
        label: `Receive ${currencySymbol}`,
        action: 'receive-tokens'
      }
    },

    staking: {
      icon: 'mdi-cash-clock',
      title: 'Ready to Earn Rewards',
      description: `Add ${currencySymbol} to your wallet to start earning staking rewards`,
      primaryAction: {
        label: `Get ${currencySymbol} to Stake`,
        icon: 'mdi-plus',
        action: 'get-tokens-for-staking'
      },
      secondaryAction: {
        label: 'Learn about staking',
        action: 'learn-staking'
      }
    },

    swap: {
      icon: 'mdi-swap-horizontal',
      title: 'Token Swapping',
      description: `Get ${currencySymbol} first, then you can swap for other tokens`,
      primaryAction: {
        label: `Get ${currencySymbol}`,
        icon: 'mdi-plus',
        action: 'get-tokens-first'
      },
      secondaryAction: {
        label: 'Learn about DEXs',
        action: 'learn-dex'
      }
    },

    nfts: {
      icon: 'mdi-image-multiple-outline',
      title: 'No NFTs Yet',
      description: 'Your NFT collection will appear here',
      primaryAction: {
        label: 'Explore NFT Marketplaces',
        icon: 'mdi-store',
        action: 'explore-nfts'
      }
    },

    defi: {
      icon: 'mdi-finance',
      title: 'DeFi Opportunities Await',
      description: `Add ${currencySymbol} to start exploring DeFi protocols and earning yields`,
      primaryAction: {
        label: 'Get Started',
        icon: 'mdi-rocket-launch',
        action: 'explore-defi'
      }
    },

    cashback: {
      icon: 'mdi-cash-refund',
      title: 'Cashback Ready',
      description: `Shop online and earn ${currencySymbol} cashback on your purchases`,
      primaryAction: {
        label: 'Browse Deals',
        icon: 'mdi-tag-multiple',
        action: 'browse-cashback'
      }
    },

    // Specific empty state for pie chart
    pieChart: {
      icon: 'mdi-chart-pie',
      title: 'Token Distribution',
      description: 'Your token allocation will be displayed here once you have tokens',
      primaryAction: {
        label: 'Add Tokens',
        icon: 'mdi-plus',
        action: 'add-tokens'
      }
    },

    // Market data when no tokens
    marketData: {
      icon: 'mdi-trending-up',
      title: 'Market Overview',
      description: `Track ${currencyTicker} price and market trends`,
      primaryAction: {
        label: `Buy ${currencySymbol}`,
        icon: 'mdi-credit-card',
        action: 'buy-crypto'
      }
    }
  };

  return configs[component] || {
    icon: 'mdi-information-outline',
    title: 'No Data Available',
    description: 'This section will populate once you have relevant data',
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
      'This is your wallet address - share it to receive tokens',
      'Keep your seed phrase safe - it\'s the only way to recover your wallet',
      'Start with a small amount to get familiar with the wallet',
      'Join the community to learn more about the ecosystem'
    ];
  }

  const tips: Record<string, string[]> = {
    portfolio: [
      'Your portfolio tracks your total balance over time',
      'You can view your balance in multiple currencies',
      'Historical data helps you understand your investment performance'
    ],
    staking: [
      'Staking earns you rewards approximately every 5 days',
      'Choose a stake pool with good performance and low fees',
      'Your tokens remain in your control while staking'
    ],
    swap: [
      'Swap tokens directly from your wallet',
      'Compare rates across multiple DEXs',
      'Set slippage tolerance for better control'
    ]
  };

  return tips[component] || [];
};
