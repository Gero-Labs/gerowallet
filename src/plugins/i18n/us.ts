import { en } from 'vuetify/lib/locale';
export default {
  rtl: 'false',
  locale: 'en-US',
  $vuetify: { ...en },
  help: 'Help',
  welcome: 'Welcome!',
  chooseAnOption: 'Select chain and network',
  chooseAWallet: 'Choose a wallet to sign in',
  termsOfService: 'Terms of Service',
  privacyPolicy: 'Privacy Policy',
  createWallet: 'Create Wallet',
  createWalletSubtitle: 'Set up a new wallet to securely manage your digital assets across multiple blockchains.',
  restoreWallet: 'Restore Wallet',
  restoreWalletSubtitle: 'Restore your existing wallet using your recovery phrase to regain access to your assets.',
  hardwareWallet: 'Hardware Wallet',
  hardwareWalletSubtitle: 'Connect your hardware wallet for enhanced security and manage your assets safely.',
  walletSetup: 'Wallet Setup',
  signIn: 'Sign In',
  multisig: {
    title: 'Multisig Transactions',
    description: 'A multisig transaction on Cardano is a transaction that requires multiple signatures from different parties to authorize spending from a shared address.',
    createMultisigWallet: 'Create Multisig Wallet',
    newMultisigTransaction: 'New Transaction',
    selectMultisigToManage: 'Select Multisig to manage',
    noWalletsToManage: 'No multisig wallets to manage'
  }
};
