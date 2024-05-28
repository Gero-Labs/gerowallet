export type Message = {
  action: MessageAction;
  data?: any;
};

export type MessageAction = 'initializeConfigTable' | 'initializeProviderTable' | 'getProvider' | 'getConfiguration' | 'getAllWallets' | 'getLatestWalletByOrder' | 'createNewWalletDb' | 'createNewWallet' | 'createNewHardwareWallet';
