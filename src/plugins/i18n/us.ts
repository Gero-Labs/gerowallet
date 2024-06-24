import { en } from 'vuetify/lib/locale';

export default {
  $vuetify: { ...en },
  common: {
    back: 'Back',
    continue: 'Continue',
    period: '.',
    reset: 'Reset',
    soon: 'Soon',
  },
  locale: 'en-US',
  navigation: {
    components: {
      drawer: {
        changeProfilePicture: 'Change Your Profile Picture',
      },
      image: {
        alt: {
          logout: 'Logout',
          logo: 'Logo',
        },
      },
    },
    layouts: {
      content: {
        image: {
          alt: {
            notifications: 'Notifications',
          },
        },
      },
      blank: {
        termsOfService: 'Terms of Service',
        help: 'Help',
      },
    },

    dialogs: {
      privacyPolicy: {
        privacyPolicy: 'Privacy Policy',
        lastModified: 'Last updated May 20, 2022',
        notice: 'This privacy notice for Gero Labs Inc. (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), describes how and why we might collect, store, use, and/or share (&quot;process&quot;) your information when you use our services (&quot;Services&quot;), such as when you:',
        visitAt: 'Visit our website at',
        url: 'https://gerowallet.io',
        anyOther: 'or any website of ours that links to this privacy notice.',
        downloadMobileApp: 'Download and use our mobile application (GeroWallet), or any other application of ours that links to this privacy notice',
        engage: 'Engage with us in other related ways, including any sales, marketing, or events',
        questions:'Questions or concerns? Reading this privacy notice will help you understand your privacy rights and choices. If you do not agree with our policies and practices, please do not use our Services. If you still have any questions or concerns, please contact us at',
        supportMail:'support@gerowallet.io',
todo:'line40'
      },
    },
  },
  rtl: 'false',
  staking: {
    views: {
      availableStakePools: 'Available Stake Pools',
      fees: 'Fees',
      geroStake: 'Stake with GERO',
      label: {
        search: 'Search by pool name or ticker',
        saturation: 'Hide Saturated',
        pledge: 'Pledge Met',
      },
      pledge: 'Pledge',
      rewards: 'Earn rewards by staking your Ap3x tokens with Apex Fusion\'s extensive network of stake pools.',
      ros: 'ROS',
      saturation: 'Saturation',
      supportUs: 'Consider supporting us',
    },
  },
  welcome: {
    dialogs: {
      createWallet: {
        agree: 'I have read and agree to the',
        clickWord: 'Please click on each word in the correct order.',
        confirmSeedPhrase: 'Confirm Seed Phrase',
        label: {
          confirmPassword: 'Confirm Password',
          noRecoverPassword: 'I understand that GeroWallet cannot recover this password for me.',
          noRecoverPhrase: 'I understand that if I lose my secret backup phrase, I will not be able to access my funds.',
          spendingPassword: 'Spending password',
          walletName: 'Wallet Name',
          walletNamePlaceholder: 'e.g. My New Wallet',
        },
        savePhrase: 'Save the seed phrase somewhere safe and never share it with anyone.',
        seedPhrase: 'Seed Phrase',
        setupWalletName: 'Set up your wallet name',
        setupWalletNameHelper: 'Choose a name to help you identify your wallet.',
        spendingPassword: 'Set up your spending password',
        spendingPasswordHelper: 'You\'ll use this to log into your wallet and make transactions.',
        terms: 'Terms of Service',
        unlock: 'Unlock',
        wallerCreation: 'Wallet Creation',
        walletIcon: 'Wallet Icon',
        writeDown: ' Write down or copy these words in the following order. \n You will need these to back up and restore your wallet.',
      },
      pairHardwareWallet: {
        agree: 'I have read and agree to the',
        bluetooth: 'Bluetooth',
        chooseName: 'Choose a name to help you identify your wallet.',
        connectType: 'What Type of Hardware Wallet Would You Like to Connect With?',
        hardwareWallets: 'Hardware wallets, a type of cold wallet, provide one of the most secure ways to keep cryptocurrencies. They work by storing your private keys in an external, physical device (usually a USB or Bluetooth device)',
        image: {
          alt: {
            connectLedger: 'Connect Ledger',
            connectTrezor: 'Connect Trezor',
          },
        },
        install: 'Install the Cardano app on your Ledger if you haven\'t already.',
        instructions: 'Instructions',
        label: {
          walletName: 'Wallet Name',
          walletNamePlaceholder: 'e.g. My New Wallet',
        },
        open: 'Open the Cardano app on the hardware wallet.',
        pairing: 'Pairing',
        setup: 'Setup your Ledger hardware wallet if it\'s new.',
        setupWalletName: 'Set up your wallet name',
        terms: 'Terms of Service',
        type: 'Type',
        unlock: 'Unlock the hardware wallet by entering your pin code on the device.',
        walletIcon: 'Wallet icon',
        walletSetup: 'Wallet Setup',
      },
      restoreWallet: {
        agree: 'I have read and agree to the',
        chooseLength: 'Choose recovery phrase length',
        enterPhase: 'Enter your wallet recovery phrase word for word.\n Make sure you enter the words in the correct order. Also ensure nobody is looking at your screen.',
        label: {
          confirmPassword: 'Confirm Password',
          noRecoverPassword: 'I understand that GeroWallet cannot recover this password for me.',
          spendingPassword: 'Spending Password',
          walletName: 'Wallet Name',
          walletNamePlaceholder: 'e.g. My New Wallet',
        },
        match: 'Password must match',
        paste: 'Paste from Clipboard',
        recoveryPhrase: 'Recovery Phrase',
        setupWalletName: 'Set up your wallet name',
        setupWalletNameHelper: 'Choose a name to help you identify your wallet.',
        spendingPassword: 'Set up your spending password',
        spendingPasswordHelper: 'You\'ll use this to log into your wallet and make transactions.',
        terms: 'Terms of Service',
        walletIcon: 'Wallet Icon',
        walletSetup: 'Wallet Setup',
      },
    },
    views: {
      chooseAWallet: 'Choose a wallet to sign in',
      chooseAnOption: 'Select chain and network',
      createWallet: 'Create Wallet',
      createWalletSubtitle: 'Create a new wallet with a new seed phrase',
      hardwareWallet: 'Hardware Wallet',
      hardwareWalletSubtitle: 'Connect your hardware wallet (Cold Wallet) via USB or Bluetooth',
      restoreWallet: 'Restore Wallet',
      restoreWalletSubtitle: 'Restore your existing wallet using a seed phrase',

      startWalletSetup: 'Start Wallet Setup',
      welcome: 'Welcome!',
    },
  },
};
