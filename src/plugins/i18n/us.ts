import { en } from 'vuetify/lib/locale';

export default {
  rtl: 'false',
  locale: 'en-US',
  $vuetify: { ...en },
  
  // ═══════════════════════════════════════
  // 🏠 GENERAL / COMMON
  // ═══════════════════════════════════════
  help: 'Help',
  welcomeMessage: 'Welcome!',
  chooseAnOption: 'Select chain and network',
  chooseAWallet: 'Choose a wallet to sign in',
  termsOfService: 'Terms of Service',
  privacyPolicy: 'Privacy Policy',
  walletSetup: 'Wallet Setup',
  signIn: 'Sign In',
  
  // ═══════════════════════════════════════
  // 💼 WALLET MODULE
  // ═══════════════════════════════════════
  wallet: {
    // Creation / Restore
  createWallet: 'Create Wallet',
  createWalletSubtitle: 'Set up a new wallet to securely manage your digital assets across multiple blockchains.',
  restoreWallet: 'Restore Wallet',
  restoreWalletSubtitle: 'Restore your existing wallet using your recovery phrase to regain access to your assets.',
  hardwareWallet: 'Hardware Wallet',
  hardwareWalletSubtitle: 'Connect your hardware wallet for enhanced security and manage your assets safely.',
    
    // General
    balance: 'Balance',
    send: 'Send',
    receive: 'Receive',
    transactions: 'Transactions',
    settings: 'Settings',
    wallet: 'Wallet',
    from: 'From',
    
    // Contacts
    editContact: 'Edit Contact',
    saveContact: 'Save Contact',
    contactAdded: 'Contact Added',
    name: 'Name',
    address: 'Address',
    done: 'Done',
    remove: 'Remove',
    
    // Send Dialog
    quickSend: 'Quick Send',
    quickSendSubtitle: 'Send {currency} or other assets to another wallet.',
    instructions: 'Instructions',
    unlockKeystone: 'Unlock your Keystone device.',
    selectScanQR: 'Select the option to scan a QR code.',
    useKeystoneToScan: 'Use your Keystone device to scan the QR code.',
    approveAndScanNext: 'Approve on the Keystone device and then click \'Next\' to scan it with Gero.',
    scanQRCode: 'Scan QR Code',
    adjustDistance: 'Adjust the distance and, if needed, tap on the Keystone QR code to enhance scanning',
    useLowDensity: 'Use a low density setting for animated QR codes if required.',
    
    // Receive Dialog
    myWalletAddresses: 'My Wallet Addresses',
    payment: 'Payment',
    reward: 'Reward',
    usedAddresses: 'Used Addresses',
    showInternal: 'Show Internal',
    address: 'Address',
    path: 'Path',
    type: 'Type',
    
    // Buy Dialog
    buySell: 'Buy / Sell',
    buySellSubtitle: 'Choose your favorite Provider for On-ramp / Off-ramp',
    provider: 'Provider',
    finalize: 'Finalize',
    buyADA: 'Buy ADA',
    buyADADescription: 'Use Credit Card or Other Payment Methods to Buy ADA',
    sellADA: 'Sell ADA',
    sellADADescription: 'Choose from multiple methods to instantly convert your ADA to cash',
    
    // Loading / Error States
    loadingYourWallet: 'Loading your wallet...',
    somethingWentWrong: 'Something went wrong',
    unexpectedError: 'An unexpected error occurred',
    tryAgain: 'Try Again',
    
    // Gero Card / Debit Card
    spendCryptoAnywhere: 'Spend Crypto Anywhere, Instantly',
    digitalAssetsSwipeReady: 'Your digital assets, now swipe-ready. Use your crypto like cash',
    orderYourCardToday: 'Order your card today',
    startKYC: 'Start KYC',
    welcomeBack: 'Welcome back, ',
    
    // Top Up Modal
    topUp: 'Top Up',
    topUpWallet: 'Top Up Wallet',
    cancel: 'Cancel',
    continue: 'Continue',
    spendingPassword: 'Spending Password',
    backToYourAccount: 'Back to Your Account',
    
    // Passwords & Security
    invalidSpendingPassword: 'Invalid spending password',
    wrongSpendingPassword: 'Wrong Spending Password!',
    enterPassword: 'Enter Password',
    confirmPassword: 'Confirm Password',
    showPassword: 'Show Password',
    hidePassword: 'Hide Password',
    spendingLockType: 'Spending Lock Type',
    
    // Card Actions
    blockCard: 'Block Card',
    unblockCard: 'Unblock Card',
    
    // Transaction States
    transactionSuccessful: 'Transaction successful!',
    transactionFailed: 'Transaction failed',
    processingTransaction: 'Processing transaction...',
    buildingTransaction: 'Building transaction...',
    signingTransaction: 'Signing transaction...',
    submittingTransaction: 'Submitting transaction...',
    youreGiving: 'You\'re giving',
    copyCBOR: 'Copy CBOR',
    
    // Wallet Types
    normalWallet: 'Normal Wallet',
    hardwareWalletType: 'Hardware Wallet',
    ledgerWallet: 'Ledger Wallet',
    keystoneWallet: 'Keystone Wallet',
    unsupportedWalletType: 'Unsupported wallet type',
  },
  
  // ═══════════════════════════════════════
  // 👥 MULTISIG MODULE
  // ═══════════════════════════════════════
  multisig: {
    title: 'Multisig Transactions',
    description: 'A multisig transaction on Cardano is a transaction that requires multiple signatures from different parties to authorize spending from a shared address.',
    createMultisigWallet: 'Create Multisig Wallet',
    newMultisigTransaction: 'New Transaction',
    newMultisigTransactionFull: 'New Multisig Transaction',
    multisigRequiresSignatures: 'A multisig wallet requires multiple parties signatures to authorize any transaction.',
    selectMultisigToManage: 'Select Multisig to manage',
    noWalletsToManage: 'No multisig wallets to manage',
    showWalletDetails: 'Wallet Details',
    fundWallet: 'Fund Wallet',
    fundWalletSubtitle: 'Add {asset} or other assets to your multisig wallet.',
    minimumSignersNote: 'The minimum signers required to execute a transaction',
    
    // Hardware Wallet Instructions
    instructions: 'Instructions',
    unlockKeystoneDevice: 'Unlock your Keystone device.',
    selectScanQROption: 'Select the option to scan a QR code.',
    useKeystoneToScan: 'Use your Keystone device to scan the QR code.',
    approveAndNext: 'Approve on the Keystone device and then click \'Next\' to scan it with Gero.',
    scanQRCode: 'Scan QR Code',
    adjustDistanceTap: 'Adjust the distance and, if needed, tap on the Keystone QR code to enhance scanning',
    useLowDensity: 'Use a low density setting for animated QR codes if required.',
  },
  
  // ═══════════════════════════════════════
  // 📊 DASHBOARD MODULE
  // ═══════════════════════════════════════
  dashboard: {
    welcomeToDashboard: 'Welcome to Gero Dashboard',
    letsGetStarted: 'Let\'s start by getting some {assetType} into your wallet!',
    claimYourTokens: 'Claim your {assetType} tokens with your Wallet by using the DApp below',
    portfolio: 'Portfolio',
    totalValue: 'Total Value',
    change24h: '24h Change',
    assets: 'Assets',
    recentTransactions: 'Recent Transactions',
    nfts: 'NFTs',
    noTokens: 'No Tokens',
    
    // Empty States
    welcomeToGeroWallet: 'Welcome to Gero Wallet!',
    emptyWallet: 'Your wallet is empty',
    getStarted: 'Get started by receiving some crypto',
    
    // Backup Section
    walletSecured: 'Wallet Secured',
    secureYourWallet: 'Secure Your Wallet',
    seedPhraseBackedUp: 'Your seed phrase has been safely backed up',
    backupSeedPhrase: 'Back up your seed phrase to protect your funds',
    seedPhraseRecoveryWarning: 'Your 24-word seed phrase is the only way to recover your wallet. Store it securely offline.',
    backupNow: 'Backup Now',
    viewSeedPhrase: 'View Seed Phrase',
    exportSeedPhrase: 'Export Seed Phrase',
    quickAndSecure: 'Quick and secure • Takes 2 minutes',
    greatJobProtected: 'Great job! Your wallet is protected. Keep your seed phrase safe.',
    
    // Staking Section
    stakeYourAssets: 'Stake Your {assetType} and Earn Rewards',
    earnRewardsByStaking: 'Earn rewards by staking your {assetType} tokens with {chain}\'s extensive network of stake pools.',
    considerSupportingUs: 'Consider supporting us by delegating your stake to GERO and start earning as soon as current epoch!',
    stakeWithGero: 'Stake with GERO',
    browseStakePools: 'Browse Stake Pools',
    needTokensBeforeStaking: 'You need to have {assetType} in your wallet before staking!',
    
    // Carousel / Features
    geroCard: 'Gero Card',
    topUpAdaInstantly: 'Top up ADA instantly!',
    adaCashback: 'ADA Cashback',
    payOnlineGetCashback: 'Pay online, and receive ADA Cashback! \n Click to see deals!',
    apexFusion: 'Apex Fusion',
    nextGenBlockchain: 'Next-generation blockchain technology',
    
    // Portfolio Chart
    portfolio: 'Portfolio',
    loadingChart: 'Loading Chart',
    noDataInWallet: 'There seems to be no data in this wallet',
  },
  
  // ═══════════════════════════════════════
  // 🥩 STAKING MODULE
  // ═══════════════════════════════════════
  staking: {
    title: 'Staking',
    
    // Delegation
    delegateYourStake: 'Delegate Your Stake',
    delegateSubtitle: 'Secure the network and earn rewards by delegating your {currency} to a stake pool.',
    delegate: 'Delegate',
    delegating: 'Delegating...',
    
    // Pool Info
    stakingPool: 'Staking Pool',
    selectPool: 'Select Pool',
    poolNotFound: 'Pool Not Found',
    
    // Delegation Info
    youCanOnlyDelegateToOne: 'You can only delegate to one stake pool at a time',
    canSwitchPools: 'You can switch to delegate to a different stake pool at any time',
    canCancelDelegation: 'You can cancel your delegation at any time',
    
    // Rewards
    rewards: 'Rewards',
    totalStaked: 'Total Staked',
    availableRewards: 'Available Rewards',
    claimRewards: 'Claim Rewards',
    withdrawStakingRewards: 'Withdraw Staking Rewards',
    withdrawSubtitle: 'Claim your accumulated rewards from staking. Confirm the details and enter your password to proceed.',
    
    // Rewards Info
    rewardsEarnedByDelegating: 'Staking rewards are earned by delegating your ADA to a stake pool.',
    stakingAllowsPassiveIncome: 'Staking allows ADA holders to earn passive income.',
    rewardsDistributedEveryEpoch: 'Rewards are typically distributed every epoch (about every 5 days).',
    rewardsAutoRestaked: 'Rewards are automatically re-staked, so you don\'t need to withdraw them for your earnings to compound.',
    
    // Unstaking
    undelegate: 'Undelegate',
    unstakeFromPool: 'Unstake from Pool',
    unstakeSubtitle: 'Deregister from your current staking pool delegation and withdraw your stake.',
    unstakingWillClaimRewards: 'Unstaking will also claim your rewards.',
    verifyUnstakeDetails: 'Please verify your unstake details and enter your spending password to proceed.',
    
    // Actions
    next: 'NEXT',
    back: 'Back',
    confirm: 'Confirm',
    delegatingTo: 'Delegating to',
    unstake: 'Unstake',
    withdraw: 'Withdraw',
    submit: 'Submit',
    
    // Staking Page
    availableStakePools: 'Available Stake Pools',
    pro: 'PRO',
    earnRewardsByStakingDesc: 'Earn rewards by staking your',
    considerSupportingUsShort: 'Consider supporting us',
    searchPoolNameTicker: 'Search by pool name or ticker',
    hideSaturated: 'Hide Saturated',
    pledgeMet: 'Pledge Met',
    retry: 'Retry',
    
    // Transaction Details
    rewardsAmount: 'Rewards Amount',
    depositFeeReturn: 'Deposit Fee Return',
    txFee: 'Tx Fee',
  },
  
  // ═══════════════════════════════════════
  // 🔄 SWAP MODULE
  // ═══════════════════════════════════════
  swap: {
    title: 'Swap',
    swap: 'SWAP',
    limit: 'LIMIT',
    
    // Token Selection
    selling: 'Selling',
    buying: 'Buying',
    selectToken: 'Select Token',
    select: 'Select',
    searchTokens: 'Search tokens',
    balance: 'Balance',
    
    // Amounts & Prices
    amount: 'Amount',
    rate: 'Rate',
    price: 'Price',
    priceImpact: 'Price Impact',
    
    // Slippage & Settings
    slippage: 'Slippage',
    slippageTolerance: 'Slippage Tolerance',
    unlimited: 'Unlimited',
    unlimitedSlippage: 'Unlimited Slippage',
    unlimitedSlippageWarning: 'The order will be filled at any price and with no limits on slippage. Due to price changes from earlier orders, this could result in an unattractive price. Use with caution.',
    learnMore: 'Learn more',
    auto: 'AUTO',
    custom: 'CUSTOM',
    settings: 'Settings',
    
    // Actions
    swapNow: 'Swap Now',
    placeOrder: 'PLACE ORDER',
    placeOrders: 'PLACE {count} ORDERS',
    
    // Errors
    insufficientBalance: 'INSUFFICIENT BALANCE',
    poolNotFound: 'Pool Not Found',
    
    // Misc
    switchPair: 'Switch Pair',
    max: 'MAX',
  },
  
  // ═══════════════════════════════════════
  // 🏛️ GOVERNANCE MODULE
  // ═══════════════════════════════════════
  governance: {
    title: 'Cardano Governance',
    subtitle: 'Cardano Governance empowers ADA holders to actively participate in shaping the network\'s future. You can cast your vote directly, choose a representative to act on your behalf, or take on the role of representing others. Additionally, you can propose your own changes to the network, engage in discussions, and ultimately bring them to a vote.',
    
    // Delegation
    newDelegation: 'New Delegation',
    delegate: 'Delegate',
    delegating: 'Delegating...',
    delegateToDRep: 'Delegate to a DRep for governance actions',
    requiredToWithdrawRewards: 'It will be required to withdraw staking rewards',
    
    // DRep Options
    ownAccount: 'Own Account (soon)',
    geroDRep: 'Gero DRep (soon)',
    abstain: 'Abstain',
    noConfidence: 'No Confidence',
    
    // DRep Info
    abstainInfo: 'When an ADA holder delegates to Abstain, their stake is marked as not participating in governance and is excluded from the active voting stake on-chain. However, it remains registered for incentive purposes.',
    noConfidenceInfo: 'Delegating to No Confidence means an ADA holder\'s stake votes "no" on all governance actions except "Motions of No Confidence," where it votes "yes," indicating distrust in the constitutional committee. This stake is part of the active voting stake and provides an auditable measure of holders\' confidence.',
    currentDelegation: 'Current Delegation',
    votingPowerLabel: 'Voting Power',
    
    // Proposals
    proposals: 'Proposals',
    activeProposals: 'Active Proposals',
    votedProposals: 'Voted Proposals',
    vote: 'Vote',
    voting: 'Voting...',
    votingPower: 'Voting Power',
    delegateVotingPower: 'Delegate Voting Power',
    
    // Links
    cardanoGovernanceTool: 'Cardano Governance Tool',
    officialDApp: 'The official Cardano DApp for governance',
    onChainGovernance: 'An On-Chain Decentralized Governance Mechanism for Voltaire',
    cip1694: 'Cardano decentralized governance proposal - CIP 1694',
    governanceParticipation: 'To participate in governance, every stake credential must be delegated to a DRep. ADA holders will typically assign their voting rights to a registered DRep who will vote on their behalf. Additionally, there are two predefined DRep options available:',
    
    // DRep Table
    id: 'ID',
    name: 'Name',
    delegators: 'Delegators',
    votes: 'Votes',
    
    // Hardware Wallet Support
    keystoneSupportComingSoon: 'Keystone wallet support is coming soon for DRep delegation',
    
    // Success Messages
    drepDelegationSuccess: 'DRep Delegation Tx Submitted Successfully. Tx ID: {txId}',
  },
  
  // ═══════════════════════════════════════
  // 💰 CASHBACK MODULE
  // ═══════════════════════════════════════
  cashback: {
    title: 'Cashback',
    available: 'Available',
    earned: 'Earned',
    claim: 'Claim',
    history: 'History',
    adaCashback: 'ADA Cashback',
    payAndReceive: 'Pay with any credit card online, and receive ADA Cashback!',
    howItWorks: 'How it works',
    readyToClaim: 'Ready to Claim',
    pendingRewards: 'Pending rewards',
    viewRewards: 'View Rewards',
    yourRewards: 'Your Rewards',
    viewPendingHistorical: 'View your pending and historical rewards',
    rewardsDetails: 'Rewards Details',
    deals: 'Deals',
    claims: 'Claims',
    pending: 'Pending',
    goCashback: 'Go Cashback!',
    cashback: 'cashback',
  },
  
  // ═══════════════════════════════════════
  // ⚙️ COMMON COMPONENTS
  // ═══════════════════════════════════════
  common: {
    // Actions
    confirm: 'Confirm',
    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    copy: 'Copy',
    copied: 'Copied',
    done: 'Done',
    ok: 'OK',
    yes: 'Yes',
    no: 'No',
    
    // Contacts
    contactsHelper: 'Contacts can be selected in the various send screens to save time',
    
    // States
    loading: 'Loading...',
    processing: 'Processing...',
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Info',
    
    // Search & Filter
    search: 'Search',
    filter: 'Filter',
    sort: 'Sort',
    sortBy: 'Sort By',
    
    // Pagination
    previous: 'Previous',
    next: 'Next',
    page: 'Page',
    of: 'of',
    
    // Misc
    more: 'More',
    less: 'Less',
    showMore: 'Show More',
    showLess: 'Show Less',
    seeAll: 'See All',
    viewAll: 'View All',
    total: 'Total',
  },
  
  // ═══════════════════════════════════════
  // ⚙️ SETTINGS / PROFILE
  // ═══════════════════════════════════════
  settings: {
    title: 'Settings',
    profile: 'Profile',
    security: 'Security',
    advanced: 'Advanced',
    collateral: 'Collateral',
    
    // Profile Tab
    displayLanguage: 'Display Language',
    setLanguageHelper: 'Set the language for Gero Dashboard',
    region: 'Region',
    regionHelper: 'Choose region, affects dates & time',
    welcomeGuide: 'Welcome Guide',
    welcomeGuideHelper: 'Display the introductory guide to help you navigate your wallet',
    showGuide: 'Show Guide',
    
    // Wallet Name
    walletName: 'Wallet Name',
    walletNameHelper: 'Give your wallet a memorable name',
    editWalletName: 'Edit your wallet name',
    
    // Currency
    currency: 'Currency',
    currencyHelper: 'Select your preferred currency',
    
    // Theme
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    auto: 'Auto',
    
    // Advanced Settings
    shopEarnPopups: 'Shop & Earn Pop-ups',
    shopEarnPopupsHelper: 'Get real-time cashback notifications as you explore supported retailer websites.',
    txAutoSubmit: 'Tx Auto Submit',
    txAutoSubmitHelper: 'Automatically submit transactions after signing',
    promptDisplayMode: 'Prompt Display Mode',
    promptDisplayModeHelper: 'Select pop-ups or side panel for signing and approval prompts',
    reSyncWallet: 'Re-Sync Wallet',
    reSyncWalletHelper: 'Replacing wallet data from the blockchain. (Might take a while)',
    reSync: 'ReSync',
    dangerZone: 'Danger Zone',
    deleteWallet: 'Delete Wallet',
    deleteWalletHelper: 'Deleting this wallet removes it from Gero Dashboard, and any remaining funds will be inaccessible. To regain access, restore using your recovery phrase',
    deleteWalletConfirmTitle: 'Are you sure you want to delete this wallet?',
    deleteWalletConfirmMessage: 'Please note that this operation will log you out from the Dashboard',
    
    // Security Tab
    extendedPublicKey: 'Extended Public Key',
    ed25519ExtendedKey: 'Ed25519-Bip32 Extended Public Key',
    recoveryPhrase: 'Recovery Phrase',
    yourWalletWasBackedUp: 'Your wallet was backed up',
    seedPhraseMasterKey: 'Your seed phrase master key - keep it offline and private',
    walletBackupRequired: 'Wallet Backup is Required',
    spendingSecuritySettings: 'Spending Security Settings',
    modifySpendingSecuritySettings: 'Modify your Spending Security Settings',
  },
  
  // ═══════════════════════════════════════
  // ⚠️ ERRORS & VALIDATION
  // ═══════════════════════════════════════
  errors: {
    // General
    required: 'This field is required',
    invalid: 'Invalid value',
    unknownError: 'Unknown error',
    somethingWentWrong: 'Something went wrong',
    pleaseTryAgain: 'Please try again',
    
    // Wallet Errors
    invalidAddress: 'Invalid address',
    invalidAmount: 'Invalid amount',
    insufficientBalance: 'Insufficient balance',
    insufficientFunds: 'Insufficient funds',
    
    // Transaction Errors
    transactionFailed: 'Transaction failed',
    transactionRejected: 'Transaction rejected',
    buildTransactionFailed: 'Failed to build transaction',
    signTransactionFailed: 'Failed to sign transaction',
    submitTransactionFailed: 'Failed to submit transaction',
    
    // Network Errors
    networkError: 'Network error',
    connectionError: 'Connection error',
    timeoutError: 'Request timeout',
    
    // Auth Errors
    invalidEmail: 'Invalid email address',
    invalidPassword: 'Invalid password',
    passwordMismatch: 'Passwords do not match',
    authenticationFailed: 'Authentication failed',
    
    // Validation
    minLength: 'Minimum length is {min} characters',
    maxLength: 'Maximum length is {max} characters',
    mustBeNumber: 'Must be a number',
    mustBePositive: 'Must be a positive number',
  },
  
  // ═══════════════════════════════════════
  // 🔔 NOTIFICATIONS & MESSAGES
  // ═══════════════════════════════════════
  notifications: {
    // Success
    transactionSubmitted: 'Transaction submitted successfully',
    transactionConfirmed: 'Transaction confirmed',
    delegationSuccess: 'Delegation successful',
    rewardsClaimed: 'Rewards claimed successfully',
    settingsSaved: 'Settings saved',
    walletCreated: 'Wallet created successfully',
    walletRestored: 'Wallet restored successfully',
    
    // Errors
    transactionError: 'Transaction error: {error}',
    delegationError: 'Delegation error: {error}',
    connectionFailed: 'Failed to connect to network',
    walletLoadFailed: 'Failed to load wallet',
    
    // Info
    checkingBalance: 'Checking balance...',
    syncingWallet: 'Syncing wallet...',
    connectingToNetwork: 'Connecting to network...',
  },
  
  // ═══════════════════════════════════════
  // 🎉 WELCOME MODULE
  // ═══════════════════════════════════════
  welcome: {
    title: 'Welcome to Gero Wallet',
    subtitle: 'Your gateway to the blockchain',
    getStarted: 'Get Started',
    
    // Wallet Creation
    createNewWallet: 'Create New Wallet',
    importExistingWallet: 'Import Existing Wallet',
    connectHardwareWallet: 'Connect Hardware Wallet',
    createWallet: 'CREATE WALLET',
    
    // Seed Phrase
    seedPhrase: 'Recovery Phrase',
    writeSeedPhrase: 'Write down your recovery phrase',
    seedPhraseWarning: 'Never share your recovery phrase with anyone. Store it safely offline.',
    verifySeedPhrase: 'Verify your recovery phrase',
    enterWord: 'Enter word #{number}',
    seedPhraseVerified: 'Recovery phrase verified successfully',
    recoveryPhraseAlert: 'Enter your wallet recovery phrase word for word. Make sure you enter the words in the correct order. Also ensure nobody is looking at your screen.',
    chooseRecoveryPhraseLength: 'Choose recovery phrase length',
    
    // Create Wallet Dialog
    createNewWallet: 'Create New Wallet',
    setUpWalletName: 'Set up your wallet name',
    chooseNameToIdentify: 'Choose a name to help you identify your wallet.',
    walletName: 'Wallet Name',
    walletNamePlaceholder: 'e.g. My New Wallet',
    walletIcon: 'Wallet Icon',
    setUpSpendingPassword: 'Set up your spending password',
    youllUseThisToLogin: 'You\'ll use this to log into your wallet and make transactions.',
    
    // Password
    createPassword: 'Create Password',
    enterPassword: 'Enter password',
    confirmPassword: 'Confirm password',
    passwordRequirements: 'Password must be at least 8 characters',
    
    // Legal
    agreeToTerms: 'I agree to the {terms} and {privacy}',
    iHaveReadTerms: 'I have read and agree to the',
    termsOfService: 'Terms of Service',
    privacyPolicy: 'Privacy Policy',
    
    // Steps
    step: 'Step {current} of {total}',
    back: 'Back',
    next: 'Next',
    finish: 'Finish',
    
    // Hardware Wallet
    hardwareWalletDescription: 'Hardware wallets, a type of cold wallet, provide one of the most secure ways to keep cryptocurrencies. They work by storing your private keys in an external, physical device (usually a USB or Bluetooth device)',
    hardwareWalletType: 'What Type of Hardware Wallet Would You Like to Connect With?',
    ledgerDescription: 'The Ledger cryptocurrency hardware wallet made by Ledger, a company headquartered in Paris, France.',
    ledgerSupport: 'Nano S, Nano S Plus, Nano X',
    trezorDescription: 'Trezor comes from SatoshiLabs, based in the Czech Republic.',
    trezorSupport: 'Model T, Safe 3',
    keystoneDescription: 'A Hong Kong-based firm provides a completely air-gapped, open-source QR code communication hardware wallet featuring a 4-inch touchscreen and a fingerprint scanner.',
    keystoneSupport: '3 Pro',
  },
  
  // ═══════════════════════════════════════
  // 🧭 NAVIGATION MODULE
  // ═══════════════════════════════════════
  navigation: {
    // Main menu
    dashboard: 'Dashboard',
    wallet: 'Wallet',
    assets: 'Assets',
    staking: 'Staking',
    swap: 'Swap',
    governance: 'Governance',
    cashback: 'Cashback',
    multisig: 'Multisig',
    transactions: 'Transactions',
    settings: 'Settings',
    
    // Quick actions
    quickActions: 'Quick Actions',
    send: 'Send',
    receive: 'Receive',
    buy: 'Buy',
    buySell: 'Buy / Sell',
    
    // Network
    network: 'Network',
    mainnet: 'Mainnet',
    testnet: 'Testnet',
    
    // Account
    account: 'Account',
    switchAccount: 'Switch Account',
    addAccount: 'Add Account',
    manageAccounts: 'Manage Accounts',
    
    // Backup
    backupWallet: 'Backup Wallet',
    backupNow: 'Backup Now',
    backupReminder: 'Please backup your wallet to secure your funds',
    
    // Beta Notice
    betaVersionNotice: 'This is a <b>Beta Version</b>. For the Official Release visit',
    geroDashboard: 'Gero Dashboard',
    inChromeStore: 'in Chrome Store.',
    
    // KYC
    uploadYourId: 'Upload Your ID',
    governmentIdOnly: 'Government issued ID only (Passport, Driving License)',
    clickToUpload: 'Click to upload',
    dragAndDrop: 'or drag and drop',
    
    // Backup Dialog
    walletBackup: 'Wallet Backup',
    seedPhraseStep: 'Seed Phrase',
    confirmPhrase: 'Confirm Phrase',
    walletCreation: 'Wallet Creation',
    writeDownWords: 'Write down or copy these words in the following order. You will need',
    
    // Receive Dialog
    hdPath: 'HD Path',
    cred: 'Cred',
    
    // Report Dialog
    reportWebsite: 'Report Website',
    reportTransaction: 'Report Transaction',
    improveCardanoShield: 'Improve Cardano Shield by letting us know if a {type} is fraudulent or trustworthy.',
    website: 'Website',
    transactionId: 'Transaction ID',
    
    // Welcome Dialog
    checkOutWhatsNew: 'Check out whats new!',
    whatsNew: 'What\'s New?',
    improvedPerformanceAndUX: 'Improved Performance and UX',
    
    // Popup
    transactionSummary: 'Transaction Summary',
    youreGiving: 'You\'re giving',
    youreReceiving: 'You\'re receiving',
    typeYourSpendingPassword: 'Type your spending password',
    connectWithGeroWallet: 'Connect with Gero Wallet',
    confirmUrlBeforeGranting: 'Confirm URL before granting the access to DApps!',
    allowTheSiteTo: 'Allow the site to:',
    viewAddressAndBalance: 'View the address and balance of the selected wallet.',
    futureTransactionsRequire: 'For your security, any future transactions from this website will require additional verification by {action} before signing.',
    enteringYourSpendingPassword: ' entering your spending password ',
    interactingWithHardware: ' interacting with your hardware wallet ',
    decline: 'Decline',
    websiteLabel: 'Website',
    notAvailable: 'N/A',
  },
  
  // ═══════════════════════════════════════
  // 🖼️ ASSETS MODULE
  // ═══════════════════════════════════════
  assets: {
    title: 'Assets',
    tokens: 'Tokens',
    nfts: 'NFTs',
    collectibles: 'Collectibles',
    
    // Token info
    balance: 'Balance',
    value: 'Value',
    price: 'Price',
    change24h: '24h Change',
    
    // Actions
    sendToken: 'Send {token}',
    receiveToken: 'Receive {token}',
    swapToken: 'Swap {token}',
    addToken: 'Add token',
    chooseCollectibles: 'Choose Collectibles',
    searchCollectibles: 'Search for collectibles',
    scamToken: 'Scam Token',
    tokenAllocation: 'Token Allocation',
    searchAssets: 'Search Assets',
    searchCollections: 'Search Collections',
    assetsFilters: 'ASSETS FILTERS',
    collectiblesFilters: 'COLLECTIBLES FILTERS',
    hideUnverifiedTokens: 'Hide Unverified Tokens',
    hideScamTokens: 'Hide Scam Tokens',
    hideScamCollectibles: 'Hide Scam Collectibles',
    hideUnratedTokens: 'Hide Unrated Tokens',
    
    // Filters
    allAssets: 'All Assets',
    verified: 'Verified',
    unverified: 'Unverified',
    favorites: 'Favorites',
    
    // Empty states
    noTokens: 'No tokens yet',
    noNFTs: 'No NFTs yet',
    getStarted: 'Get started by receiving some assets',
    items: 'items',
    scam: 'Scam',
  },
  
  // ═══════════════════════════════════════
  // 📝 BLOG MODULE
  // ═══════════════════════════════════════
  blog: {
    title: 'Blog Posts',
    search: 'Search',
    minRead: 'min read',
    views: 'views',
  },
  
  // ═══════════════════════════════════════
  // 🔒 SECURITY MODULE
  // ═══════════════════════════════════════
  security: {
    transactionRisk: 'Transaction Risk',
    cardanoShieldNote: 'Cardano Shield provides security insights on a best-effort basis. Accuracy is not guaranteed, and users should exercise their own caution.',
    poweredBy: 'Powered by',
  },
  
  // ═══════════════════════════════════════
  // 📜 TRANSACTIONS MODULE (расширение)
  // ═══════════════════════════════════════
  transactions: {
    title: 'Transactions',
    recent: 'Recent Transactions',
    all: 'All Transactions',
    pending: 'Pending',
    confirmed: 'Confirmed',
    failed: 'Failed',
    sent: 'Sent',
    received: 'Received',
    fee: 'Fee',
    amount: 'Amount',
    date: 'Date',
    status: 'Status',
    transactionId: 'Transaction ID',
    noTransactions: 'No transactions yet',
    activity: 'Activity',
    search: 'Search',
    
    // Transaction Types
    delegatingToPool: 'Delegating to Pool',
    stakeDeregistration: 'Stake Deregistration',
    voteDelegation: 'Vote Delegation',
    delegatingTo: 'Delegating to {pool}',
    receivedFundsAndTokens: 'Received Funds & Tokens',
    sentFundsAndTokens: 'Sent Funds & Tokens',
    receivedFundsAndSentTokens: 'Received Funds & Sent Tokens',
    sentFundsAndReceivedTokens: 'Sent Funds & Received Tokens',
    receivedFunds: 'Received Funds',
    sentFunds: 'Sent Funds',
    receivedTokens: 'Received Tokens',
    sentTokens: 'Sent Tokens',
    withdrawal: 'Withdrawal',
    pending: 'Pending',
    cashback: 'Cashback',
    epoch: 'Epoch',
    
    // Loading states
    loadingMoreTransactions: 'Loading more transactions...',
    noMoreTransactions: 'No more transactions to load',
    noTransactionsFound: 'No transactions found',
    
    // Details
    details: 'Transaction Details',
    from: 'From',
    to: 'To',
    blockHeight: 'Block Height',
    confirmations: 'Confirmations',
    timestamp: 'Timestamp',
    
    // Actions
    viewOnExplorer: 'View on Explorer',
    copyTxId: 'Copy Transaction ID',
    
    // Filters
    filterBy: 'Filter by',
    allTypes: 'All Types',
    sendReceive: 'Send/Receive',
    delegation: 'Delegation',
    rewards: 'Rewards',
    
    // DEX Labels
    stakeRegistration: 'Stake Registration',
    minswap: 'Minswap',
    muesliswap: 'MuesliSwap',
    sundaeswap: 'SundaeSwap',
    splash: 'Splash',
  },
};
