import { scoreIndexEntry } from '@/shared/utils/searchScore';
import { MAX_PER_SOURCE, type Translate } from '@/shared/utils/governanceSearch';
import networks from '@/utils/networks';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';
import { isEligibleWallet } from '@/services/notify/notifyEligibility';
import type { QuickActionDialog } from '@/shared/composables/useQuickActionDialogs';
// TYPE-ONLY on purpose, as in governanceSearch.ts: a value import would pull
// the search composable's store/API graph into this module and back again.
import type { SearchResult } from '@/shared/composables/useGlobalSearch';

/**
 * The wallet's static search indexes: its pages, its one-shot actions and its
 * settings rows, plus `searchGates`, which decides which of them exist for the
 * logged-in wallet.
 *
 * Pure, like `governanceSearch.ts`: the caller hands in the wallet and the
 * flags, so chain isolation and ranking are both testable without a store.
 *
 * Keywords carry EN, DE and ES terms beyond the translated title; matching
 * folds accents on both sides (`scoreIndexEntry`).
 */

/**
 * Capabilities an entry can require, resolved by `searchGates`. An entry whose
 * gate is off is not offered at all, because a result that bounces to `/` or
 * opens a tab without the row is worse than no result.
 */
export type SearchGate =
  // Pages and actions
  | 'cardanoFamily' // Cardano and its Apex forks: their assets, NFTs, collateral and portfolio views
  | 'market' // market + watchlist views: Cardano mainnet only
  | 'transactions'
  | 'utxos'
  | 'midnight'
  | 'staking'
  | 'governance'
  | 'governanceVoting'
  | 'realfi'
  | 'card'
  | 'goMining'
  | 'babylon'
  | 'ordinals'
  | 'thorchain'
  | 'mempool'
  | 'lightning'
  | 'cashback'
  | 'mediaPlayer'
  | 'blog'
  | 'copilotFeed'
  | 'poolOperator'
  | 'swap'
  | 'buy'
  | 'perpetuals'
  // Settings rows
  | 'backup'
  | 'spendingPassword'
  | 'mpc'
  | 'remoteSigning'
  | 'verifyAddress'
  | 'supportChat'
  | 'notify'
  // Cardano wallets holding their network's cNIGHT: the DUST strip under the NIGHT row
  | 'cnightDust';

export type SearchGates = Record<SearchGate, boolean>;

/** The feature flags the gates read. `featureFlagsStore` satisfies it. */
export interface SearchFlags {
  isBitcoinEnabled(): boolean;
  isRealFiEnabled(): boolean;
  isGeroCardEnabled(): boolean;
  isGoMiningEnabled(): boolean;
  isBlogEnabled(): boolean;
  isCopilotEnabled(): boolean;
  isPoolOperatorEnabled(): boolean;
  isGovernanceEnabled(): boolean;
  isGovernanceVotingEnabled(): boolean;
  isCrossDeviceSigningEnabled(): boolean;
  isLiveChatEnabled(): boolean;
}

export interface GateInputs {
  /** The logged-in wallet, narrowed to what the gates read. */
  wallet: Partial<Pick<Wallet, 'chain' | 'network' | 'type' | 'encryptionMethod' | 'stakeAddress'>> | null | undefined;
  flags: SearchFlags;
  /** `WalletStore.hasBackup()`: this wallet's config tracks a backup at all. */
  hasBackupState: boolean;
  /** Tracks in the media player's playlist. */
  playlistLength: number;
  /**
   * The wallet holds its network's cNIGHT: the condition MarketTokenTable
   * renders the "generate DUST" strip under. Optional, absent means no.
   */
  holdsCnight?: boolean;
}

/**
 * What the logged-in wallet can reach.
 *
 * Chain isolation is the first rule: every chain-specific entry is gated on
 * the logged-in wallet's own chain (and network), never on what the app has
 * seen before, so a Cardano wallet is never offered Midnight's proof server,
 * Bitcoin's Lightning page or Cardano collateral on Midnight.
 *
 * Beyond that, a page's gate is its router guard (the `routeNetworkGuards`
 * entry AND the `isRouteUnderMaintenance` flag in
 * `src/modules/navigation/router.ts`, which the navigation drawer mirrors) and
 * a settings gate is the `v-if` on its row. Keep each in step with its source.
 */
export function searchGates({ wallet, flags, hasBackupState, playlistLength, holdsCnight = false }: GateInputs): SearchGates {
  const chain = wallet?.chain ?? '';
  const network = wallet?.network ?? '';
  const isCardanoFamily = chain === Blockchain.CARDANO || chain === Blockchain.APEX_PRIME || chain === Blockchain.APEX_VECTOR;
  const bitcoin = flags.isBitcoinEnabled();
  const governance = !!networks.resolveGovernanceSupport(chain, network) && flags.isGovernanceEnabled();
  const transactions = !!networks.resolveTransactionsSupport(chain, network);
  return {
    // Bitcoin and Midnight render their own dashboards: no holdings or
    // collectibles views, no Cardano assets or collateral.
    cardanoFamily: isCardanoFamily,
    // PortfolioPage's `isMainnetCardano`, which gates the Market and Watchlist chips.
    market: chain === Blockchain.CARDANO && network === Network.MAINNET,
    transactions,
    // Cardano-family and Midnight UTxO tables; UtxosTable has no Bitcoin rendering.
    utxos: transactions && chain !== Blockchain.BITCOIN,
    midnight: chain === Blockchain.MIDNIGHT,
    staking: !!networks.resolveStakingSupport(chain, network),
    governance,
    // Registration rides the voting sub-flag, as the router's `governanceRegister` case does.
    governanceVoting: governance && flags.isGovernanceVotingEnabled(),
    realfi: !!networks.resolveRealFiSupport(chain, network) && flags.isRealFiEnabled(),
    card: !!networks.resolveGeroCardSupport(chain, network) && flags.isGeroCardEnabled(),
    goMining: !!networks.resolveGoMiningSupport(chain, network) && bitcoin && flags.isGoMiningEnabled(),
    babylon: !!networks.resolveBabylonSupport(chain, network) && bitcoin,
    ordinals: !!networks.resolveOrdinalsSupport(chain, network) && bitcoin,
    thorchain: !!networks.resolveThorchainSupport(chain, network) && bitcoin,
    mempool: !!networks.resolveMempoolSupport(chain, network) && bitcoin,
    lightning: !!networks.resolveLightningSupport(chain, network) && bitcoin,
    cashback: !!networks.resolveCashbackSupport(chain, network),
    // The drawer only excludes Bitcoin and Apex Vector; the playlist is built
    // from Cardano NFTs, so search names the chains it can come from.
    mediaPlayer: isCardanoFamily && chain !== Blockchain.APEX_VECTOR && playlistLength > 0,
    // Not chain features: the drawer shows these on every chain.
    blog: flags.isBlogEnabled(),
    copilotFeed: flags.isCopilotEnabled(),
    poolOperator: !!networks.resolveStakingSupport(chain, network) && flags.isPoolOperatorEnabled(),
    swap: !!networks.resolveSwapSupport(chain, network),
    // Quick actions: QuickActionsBox's own conditions for the button.
    buy: !!networks.resolveBuySupported(chain, network),
    perpetuals: !!networks.resolvePerpetualsSupport(chain, network),
    // Settings rows: SecurityTab's `canBackup`, the spending-password row,
    // `isMpcWallet`, `canRemoteSigning`, `isHardwareWallet && canVerifyAddress`,
    // and AdvancedSettingsTab's `isSupportChatAvailable`.
    backup: wallet?.type === WalletType.Normal && hasBackupState,
    spendingPassword: wallet?.type === WalletType.Normal && wallet?.encryptionMethod !== 'prf',
    mpc: wallet?.encryptionMethod === 'mpc',
    remoteSigning: flags.isCrossDeviceSigningEnabled() && chain === Blockchain.CARDANO && wallet?.type === WalletType.Normal,
    verifyAddress: (wallet?.type === WalletType.Ledger || wallet?.type === WalletType.Trezor) && chain === Blockchain.BITCOIN,
    supportChat: flags.isCopilotEnabled() || flags.isLiveChatEnabled(),
    // The Notifications tab's per-wallet rows: the tab shows "not available for
    // this wallet" to anything the push service cannot serve.
    notify: !!wallet && isEligibleWallet({ chain, network, type: wallet.type, stakeAddress: wallet.stakeAddress }),
    // cNIGHT is a Cardano asset; a Midnight wallet registers from its own
    // DUST battery instead (the `midnight` gate).
    cnightDust: chain === Blockchain.CARDANO && holdsCnight,
  };
}

export interface IndexOptions {
  t: Translate;
  can: (gate: SearchGate) => boolean;
}

interface IndexEntry {
  keywords: string[];
  titleKey: string;
  icon: string;
  requires?: SearchGate;
}

interface PageEntry extends IndexEntry {
  /** Router location; a query string is fine, `router.push` parses it. */
  route: string;
  /** The drawer section (or parent page) the page sits under. */
  subtitleKey?: string;
}

/** What selecting an action result does. Performed by `GlobalSearch.vue`. */
export type SearchAction =
  | { kind: 'dialog'; dialog: Exclude<QuickActionDialog, null> }
  | { kind: 'toggleBalances' }
  /** A deep link whose page opens the dialog itself, e.g. `/?dust=register`. */
  | { kind: 'route'; route: string };

interface ActionEntry extends IndexEntry {
  id: string;
  action: SearchAction;
}

interface SettingEntry extends IndexEntry {
  /** `SettingsDialog` tab value. */
  tab: string;
  subtitleKey: string;
}

/**
 * Every page the navigation drawer can show, plus the destinations that live
 * inside a page (portfolio views, the UTxOs tab) or outside the drawer (Swap).
 * Governance's own pages are indexed in `governanceSearch.ts`.
 */
export const PAGE_INDEX: readonly PageEntry[] = [
  { route: '/', titleKey: 'navigation.dashboard', icon: 'mdi-view-dashboard-outline', keywords: ['home', 'dashboard', 'portfolio', 'overview', 'balance', 'startseite', 'übersicht', 'guthaben', 'inicio', 'panel', 'cartera', 'portafolio', 'resumen', 'saldo'] },
  { route: '/?view=holdings', titleKey: 'portfolio.myHoldings', subtitleKey: 'navigation.dashboard', icon: 'mdi-wallet-outline', requires: 'cardanoFamily', keywords: ['holdings', 'my tokens', 'my assets', 'assets', 'bestände', 'meine token', 'vermögenswerte', 'tenencias', 'mis tokens', 'mis activos', 'activos'] },
  { route: '/?view=collectibles', titleKey: 'portfolio.collectibles', subtitleKey: 'navigation.dashboard', icon: 'mdi-image-multiple', requires: 'cardanoFamily', keywords: ['collectibles', 'nfts', 'nft', 'gallery', 'sammlerstücke', 'galerie', 'coleccionables', 'galería'] },
  { route: '/?view=market', titleKey: 'navigation.market', subtitleKey: 'navigation.dashboard', icon: 'mdi-chart-line', requires: 'market', keywords: ['market', 'prices', 'token prices', 'trending', 'markt', 'kurse', 'preise', 'mercado', 'precios'] },
  { route: '/?view=watchlist', titleKey: 'portfolio.watchlist', subtitleKey: 'navigation.dashboard', icon: 'mdi-star-outline', requires: 'market', keywords: ['watchlist', 'favorites', 'favourites', 'starred', 'beobachtungsliste', 'favoriten', 'lista de seguimiento', 'favoritos'] },
  { route: '/transactions', titleKey: 'navigation.transactions', subtitleKey: 'navigation.financialHub', icon: 'mdi-history', requires: 'transactions', keywords: ['transactions', 'history', 'activity', 'tx history', 'export csv', 'transaktionen', 'verlauf', 'aktivität', 'transacciones', 'historial', 'actividad'] },
  { route: '/transactions?tab=utxos', titleKey: 'transactions.utxos', subtitleKey: 'navigation.transactions', icon: 'mdi-cube-outline', requires: 'utxos', keywords: ['utxos', 'utxo', 'unspent outputs', 'coin control', 'unverbrauchte ausgaben', 'salidas no gastadas'] },
  { route: '/proof-server', titleKey: 'navigation.midnightProofServer', subtitleKey: 'navigation.financialHub', icon: 'mdi-server-security', requires: 'midnight', keywords: ['proof server', 'zk proofs', 'proving', 'zkpaas', 'beweisserver', 'servidor de pruebas', 'pruebas zk'] },
  { route: '/staking', titleKey: 'navigation.staking', subtitleKey: 'navigation.financialHub', icon: 'mdi-cash-multiple', requires: 'staking', keywords: ['staking', 'stake', 'stake pool', 'delegate stake', 'staking rewards', 'staken', 'delegieren', 'belohnungen', 'delegar', 'recompensas', 'pool de staking'] },
  { route: '/realfi', titleKey: 'navigation.realfi', subtitleKey: 'navigation.financialHub', icon: 'mdi-sprout-outline', requires: 'realfi', keywords: ['earn', 'realfi', 'yield', 'usdrf', 'savings', 'interest', 'verdienen', 'rendite', 'zinsen', 'ganar', 'rendimiento', 'ahorros', 'intereses'] },
  { route: '/card', titleKey: 'navigation.geroCard', subtitleKey: 'navigation.financialHub', icon: 'mdi-credit-card-outline', requires: 'card', keywords: ['card', 'gero card', 'debit card', 'zione', 'karte', 'debitkarte', 'tarjeta', 'tarjeta de débito'] },
  { route: '/gomining', titleKey: 'navigation.goMining', subtitleKey: 'navigation.financialHub', icon: 'mdi-pickaxe', requires: 'goMining', keywords: ['gomining', 'mining', 'bitcoin mining', 'hashrate', 'minería'] },
  { route: '/babylon', titleKey: 'babylon.title', subtitleKey: 'navigation.financialHub', icon: 'mdi-bitcoin', requires: 'babylon', keywords: ['babylon', 'staking', 'btc staking', 'bitcoin staking', 'finality provider', 'staken'] },
  { route: '/ordinals', titleKey: 'navigation.ordinals', subtitleKey: 'navigation.financialHub', icon: 'mdi-image-multiple-outline', requires: 'ordinals', keywords: ['ordinals', 'inscriptions', 'runes', 'brc-20', 'inschriften', 'inscripciones'] },
  { route: '/thorchain', titleKey: 'navigation.thorchain', subtitleKey: 'navigation.financialHub', icon: 'mdi-swap-horizontal', requires: 'thorchain', keywords: ['thorchain', 'cross-chain swap', 'swap btc', 'kettenübergreifend', 'intercambio entre cadenas'] },
  { route: '/mempool', titleKey: 'navigation.mempool', subtitleKey: 'navigation.financialHub', icon: 'mdi-database-clock', requires: 'mempool', keywords: ['mempool', 'fee rates', 'network fees', 'blocks', 'explorer', 'gebühren', 'blöcke', 'comisiones', 'bloques', 'explorador'] },
  { route: '/lightning', titleKey: 'navigation.lightning', subtitleKey: 'navigation.financialHub', icon: 'mdi-lightning-bolt', requires: 'lightning', keywords: ['lightning', 'lnurl', 'lightning network', 'invoice', 'rechnung', 'factura'] },
  { route: '/swap', titleKey: 'navigation.swap', icon: 'mdi-swap-horizontal', requires: 'swap', keywords: ['swap', 'exchange', 'trade', 'dex', 'convert', 'pending orders', 'tauschen', 'handeln', 'intercambiar', 'convertir', 'órdenes pendientes'] },
  { route: '/cashback', titleKey: 'navigation.cashback', subtitleKey: 'navigation.activitiesRewards', icon: 'mdi-shopping', requires: 'cashback', keywords: ['cashback', 'shop', 'shopping', 'stores', 'bring', 'einkaufen', 'prämien', 'compras', 'tiendas'] },
  { route: '/media-player', titleKey: 'navigation.mediaPlayer', subtitleKey: 'navigation.media', icon: 'mdi-music-box-multiple-outline', requires: 'mediaPlayer', keywords: ['media player', 'music', 'audio', 'songs', 'playlist', 'musik', 'música', 'reproductor', 'canciones'] },
  { route: '/blog', titleKey: 'navigation.blog', icon: 'mdi-post-outline', requires: 'blog', keywords: ['blog', 'news', 'articles', 'nachrichten', 'artikel', 'noticias', 'artículos'] },
  { route: '/copilot-feed', titleKey: 'navigation.copilotFeed', icon: 'mdi-bell-outline', requires: 'copilotFeed', keywords: ['feed', 'copilot', 'news feed', 'insights'] },
  { route: '/pool-operator', titleKey: 'navigation.poolOperator', subtitleKey: 'navigation.developers', icon: 'mdi-server-network', requires: 'poolOperator', keywords: ['pool operator', 'spo', 'stake pool operator', 'kes', 'block producer', 'node', 'pool-betreiber', 'operador de pool', 'nodo'] },
  { route: '/nexus', titleKey: 'navigation.nexus', subtitleKey: 'navigation.developers', icon: 'mdi-hexagon-multiple-outline', keywords: ['nexus', 'api', 'developers', 'infrastructure', 'entwickler', 'desarrolladores'] },
];

/** The header's quick actions, plus the balance-privacy toggle beside them. */
export const ACTION_INDEX: readonly ActionEntry[] = [
  { id: 'send', action: { kind: 'dialog', dialog: 'SEND' }, titleKey: 'navigation.send', icon: 'mdi-arrow-up-bold-circle-outline', keywords: ['send', 'transfer', 'payment', 'senden', 'überweisen', 'zahlung', 'enviar', 'transferir', 'pagar'] },
  { id: 'receive', action: { kind: 'dialog', dialog: 'RECEIVE' }, titleKey: 'navigation.receive', icon: 'mdi-arrow-down-bold-circle-outline', keywords: ['receive', 'deposit', 'my address', 'wallet address', 'qr code', 'empfangen', 'einzahlen', 'meine adresse', 'recibir', 'depositar', 'mi dirección', 'código qr'] },
  { id: 'buy', action: { kind: 'dialog', dialog: 'BUY' }, titleKey: 'navigation.buySell', icon: 'mdi-cash-plus', requires: 'buy', keywords: ['buy', 'sell', 'on-ramp', 'off-ramp', 'moonpay', 'kaufen', 'verkaufen', 'comprar', 'vender'] },
  { id: 'perpetuals', action: { kind: 'dialog', dialog: 'PERPETUALS' }, titleKey: 'perpetuals.perpetuals', icon: 'mdi-chart-areaspline', requires: 'perpetuals', keywords: ['perpetuals', 'perps', 'futures', 'leverage', 'hebel', 'perpetuos', 'futuros', 'apalancamiento'] },
  { id: 'toggleBalances', action: { kind: 'toggleBalances' }, titleKey: 'dashboard.hideBalances', icon: 'mdi-eye-off-outline', keywords: ['hide balances', 'show balances', 'privacy mode', 'hide amounts', 'guthaben ausblenden', 'guthaben anzeigen', 'ocultar saldos', 'mostrar saldos', 'modo privado'] },
  // DUST, one entry per chain that has a way in: a Midnight wallet's DUST
  // battery, or the cNIGHT strip on a Cardano wallet holding NIGHT. Both open
  // through PortfolioPage's `?dust=register`, which picks the chain's dialog.
  { id: 'dustRegistration', action: { kind: 'route', route: '/?dust=register' }, titleKey: 'midnight.dustRegistrationChip', icon: 'mdi-battery-charging-outline', requires: 'midnight', keywords: ['dust', 'dust registration', 'register for dust', 'dust battery', 'dust generation', 'dust balance', 'dust address', 'dust-registrierung', 'dust-batterie', 'registro de dust', 'batería de dust', 'generación de dust'] },
  { id: 'cnightDust', action: { kind: 'route', route: '/?dust=register' }, titleKey: 'midnight.cnightRegisterTitle', icon: 'mdi-battery-charging-outline', requires: 'cnightDust', keywords: ['dust', 'generate dust', 'dust registration', 'register for dust', 'dust generation', 'cnight', 'dust erzeugen', 'dust-registrierung', 'generar dust', 'registro de dust'] },
];

/**
 * Every row of the settings dialog worth jumping to. `requires` mirrors the
 * row's own `v-if` in its tab, so search never opens a tab the row is not on.
 */
export const SETTINGS_INDEX: readonly SettingEntry[] = [
  // The dialog itself
  { keywords: ['settings', 'preferences', 'options', 'configuration', 'einstellungen', 'optionen', 'configuración', 'ajustes', 'preferencias', 'opciones'], tab: 'profile', titleKey: 'common.settings', subtitleKey: 'settings.profile', icon: 'mdi-cog-outline' },
  // Profile
  { keywords: ['wallet name', 'rename wallet', 'edit name', 'wallet-name', 'umbenennen', 'nombre de la billetera', 'renombrar', 'cambiar nombre'], tab: 'profile', titleKey: 'settings.walletName', subtitleKey: 'settings.profile', icon: 'mdi-pencil' },
  { keywords: ['profile picture', 'avatar', 'wallet picture', 'photo', 'profilbild', 'foto de perfil', 'imagen de la billetera'], tab: 'profile', titleKey: 'settings.walletProfilePicture', subtitleKey: 'settings.profile', icon: 'mdi-account-circle' },
  { keywords: ['currency', 'usd', 'eur', 'dollar', 'euro', 'currency preference', 'währung', 'moneda', 'divisa'], tab: 'profile', titleKey: 'settings.currencyPreference', subtitleKey: 'settings.profile', icon: 'mdi-currency-usd' },
  { keywords: ['language', 'german', 'english', 'deutsch', 'display language', 'sprache', 'anzeigesprache', 'spanish', 'spanisch', 'español', 'idioma', 'inglés', 'alemán'], tab: 'profile', titleKey: 'settings.displayLanguage', subtitleKey: 'settings.profile', icon: 'mdi-translate' },
  { keywords: ['region', 'región'], tab: 'profile', titleKey: 'settings.region', subtitleKey: 'settings.profile', icon: 'mdi-map-marker' },
  { keywords: ['welcome guide', 'onboarding', 'tutorial', 'anleitung', 'guía de bienvenida'], tab: 'profile', titleKey: 'settings.welcomeGuide', subtitleKey: 'settings.profile', icon: 'mdi-book-open-variant' },
  // Collateral
  { keywords: ['collateral', 'set collateral', '5 ada', 'kollateral', 'sicherheit', 'colateral', 'garantía'], tab: 'collateral', titleKey: 'settings.collateral', subtitleKey: 'settings.collateral', icon: 'mdi-shield-lock', requires: 'cardanoFamily' },
  // Contacts
  { keywords: ['contacts', 'address book', 'add contact', 'saved addresses', 'kontakte', 'adressbuch', 'contactos', 'libreta de direcciones', 'agregar contacto'], tab: 'contacts', titleKey: 'settings.contacts', subtitleKey: 'settings.contacts', icon: 'mdi-contacts' },
  // Connected DApps
  { keywords: ['dapps', 'connected dapps', 'connected sites', 'remove dapp', 'disconnect dapp', 'walletconnect', 'verbundene dapps', 'dapps conectadas', 'sitios conectados', 'desconectar dapp'], tab: 'connectedDapps', titleKey: 'settings.connectedDApps', subtitleKey: 'settings.connectedDApps', icon: 'mdi-application-brackets' },
  // Security
  { keywords: ['public key', 'extended public key', 'ed25519', 'xpub', 'öffentlicher schlüssel', 'clave pública', 'clave pública extendida'], tab: 'security', titleKey: 'settings.extendedPublicKey', subtitleKey: 'settings.security', icon: 'mdi-key' },
  { keywords: ['recovery phrase', 'seed phrase', 'mnemonic', 'backup', 'back up', 'wiederherstellungsphrase', 'sicherung', 'frase de recuperación', 'frase semilla', 'semilla', 'respaldo', 'respaldar'], tab: 'security', titleKey: 'settings.recoveryPhrase', subtitleKey: 'settings.security', icon: 'mdi-shield-key', requires: 'backup' },
  { keywords: ['recovery password', 'change recovery password', 'google wallet', 'wiederherstellungspasswort', 'contraseña de recuperación'], tab: 'security', titleKey: 'security.mpcRecoveryChangeTitle', subtitleKey: 'settings.security', icon: 'mdi-form-textbox-password', requires: 'mpc' },
  { keywords: ['reveal recovery phrase', 'reveal seed', 'show seed phrase', 'export seed', 'phrase anzeigen', 'revelar frase', 'mostrar frase de recuperación'], tab: 'security', titleKey: 'security.mpcRevealTitle', subtitleKey: 'settings.security', icon: 'mdi-eye-outline', requires: 'mpc' },
  { keywords: ['spending password', 'change password', 'spending security', 'ausgabenpasswort', 'passwort ändern', 'contraseña', 'contraseña de gasto', 'cambiar contraseña', 'seguridad de las transacciones', 'autorizar transacciones'], tab: 'security', titleKey: 'settings.spendingSecuritySettings', subtitleKey: 'settings.security', icon: 'mdi-lock', requires: 'spendingPassword' },
  { keywords: ['lock settings', 'auto lock', 'auto-lock', 'unlock method', 'pin', 'pattern', 'sperreinstellungen', 'entsperrmethode', 'bloqueo', 'bloqueo automático', 'método de desbloqueo', 'patrón'], tab: 'security', titleKey: 'security.lockSettings', subtitleKey: 'settings.security', icon: 'mdi-lock-clock' },
  { keywords: ['passkey', 'biometric', 'webauthn', 'fingerprint', 'face id', 'biometrisch', 'fingerabdruck', 'biometría', 'huella digital'], tab: 'security', titleKey: 'security.lockSettings', subtitleKey: 'settings.security', icon: 'mdi-fingerprint' },
  { keywords: ['remote signing', 'cross-device', 'cross device', 'paired devices', 'phone signing', 'fernsignierung', 'gekoppelte geräte', 'firma remota', 'dispositivos vinculados'], tab: 'security', titleKey: 'crossDevice.settings.title', subtitleKey: 'settings.security', icon: 'mdi-cellphone-link', requires: 'remoteSigning' },
  { keywords: ['verify address', 'verify on device', 'ledger', 'trezor', 'hardware wallet', 'adresse verifizieren', 'verificar dirección'], tab: 'security', titleKey: 'settings.verifyAddress', subtitleKey: 'settings.security', icon: 'mdi-shield-check', requires: 'verifyAddress' },
  { keywords: ['website protection', 'malicious', 'cardano shield', 'phishing', 'webseiten-schutz', 'bösartig', 'protección de sitios web', 'protección contra sitios maliciosos', 'sitio malicioso'], tab: 'security', titleKey: 'settings.websiteProtection', subtitleKey: 'settings.security', icon: 'mdi-shield-check' },
  // Notifications
  { keywords: ['notifications', 'push', 'alerts', 'notify', 'benachrichtigungen', 'mitteilungen', 'notificaciones', 'alertas'], tab: 'notifications', titleKey: 'notify.browser.title', subtitleKey: 'settings.notifications', icon: 'mdi-bell-outline' },
  { keywords: ['show amounts', 'minimum amount', 'mute wallet', 'beträge anzeigen', 'mindestbetrag', 'stummschalten', 'mostrar montos', 'monto mínimo', 'silenciar billetera'], tab: 'notifications', titleKey: 'notify.wallet.title', subtitleKey: 'settings.notifications', icon: 'mdi-bell-ring-outline', requires: 'notify' },
  { keywords: ['alert types', 'notification types', 'categories', 'warnungen', 'kategorien', 'tipos de alerta', 'categorías'], tab: 'notifications', titleKey: 'notify.categories.title', subtitleKey: 'settings.notifications', icon: 'mdi-bell-ring-outline', requires: 'notify' },
  { keywords: ['security alerts', 'sicherheitswarnungen', 'alertas de seguridad'], tab: 'notifications', titleKey: 'notify.security.title', subtitleKey: 'settings.notifications', icon: 'mdi-shield-alert-outline', requires: 'notify' },
  // Advanced
  { keywords: ['shop earn', 'cashback popups', 'bring', 'shop and earn', 'einkaufen', 'cashback', 'compras'], tab: 'advanced', titleKey: 'settings.shopEarnPopups', subtitleKey: 'settings.advanced', icon: 'mdi-shopping', requires: 'cashback' },
  { keywords: ['auto submit', 'tx auto submit', 'transaction auto', 'automatisch senden', 'envío automático'], tab: 'advanced', titleKey: 'settings.txAutoSubmit', subtitleKey: 'settings.advanced', icon: 'mdi-send-check' },
  { keywords: ['auto withdraw', 'auto-withdraw', 'withdraw rewards', 'claim rewards', 'belohnungen abheben', 'automatisch abheben', 'retirar recompensas', 'retiro automático'], tab: 'advanced', titleKey: 'settings.autoWithdrawRewards', subtitleKey: 'settings.advanced', icon: 'mdi-cash-refund', requires: 'staking' },
  { keywords: ['extension click', 'click action', 'mini mode', 'mini gero', 'side panel', 'sidepanel', 'toolbar icon', 'klickaktion', 'seitenleiste', 'modo mini', 'panel lateral'], tab: 'advanced', titleKey: 'settings.extensionClickAction', subtitleKey: 'settings.advanced', icon: 'mdi-cursor-default-click-outline' },
  { keywords: ['support chat', 'chat button', 'help', 'live chat', 'support', 'hilfe', 'ayuda', 'soporte', 'chat de soporte'], tab: 'advanced', titleKey: 'settings.supportChatButton', subtitleKey: 'settings.advanced', icon: 'mdi-chat-outline', requires: 'supportChat' },
  { keywords: ['resync', 're-sync', 'sync wallet', 'refresh', 'synchronisieren', 'aktualisieren', 'resincronizar', 'sincronizar billetera', 'actualizar'], tab: 'advanced', titleKey: 'settings.reSyncWallet', subtitleKey: 'settings.advanced', icon: 'mdi-sync' },
  { keywords: ['delete wallet', 'remove wallet', 'danger', 'wallet löschen', 'entfernen', 'eliminar billetera', 'borrar billetera'], tab: 'advanced', titleKey: 'settings.deleteWallet', subtitleKey: 'settings.advanced', icon: 'mdi-delete' },
];

/** The entries `can` allows that match `query`, best first, capped per source. */
function rank<E extends IndexEntry>(
  entries: readonly E[],
  query: string,
  { t, can }: IndexOptions,
  titleKeyFor: (entry: E) => string = entry => entry.titleKey,
): { entry: E; title: string; score: number }[] {
  if (!query.trim()) return [];
  return entries
    .filter(entry => !entry.requires || can(entry.requires))
    .map(entry => {
      const title = String(t(titleKeyFor(entry)));
      return { entry, title, score: scoreIndexEntry(entry.keywords, title, query) };
    })
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PER_SOURCE);
}

/** Wallet pages matching `query`. Selected through `route`, like governance's pages. */
export function pageResults(query: string, options: IndexOptions): SearchResult[] {
  return rank(PAGE_INDEX, query, options).map(({ entry, title, score }) => ({
    type: 'page' as const,
    id: `page-${entry.route}`,
    title,
    subtitle: entry.subtitleKey ? String(options.t(entry.subtitleKey)) : '',
    icon: entry.icon,
    route: entry.route,
    _score: score,
  }));
}

/**
 * One-shot actions matching `query`. The balance toggle is titled for what it
 * will do next, so `balancesHidden` flips it to "Show balances".
 */
export function actionResults(query: string, options: IndexOptions & { balancesHidden: boolean }): SearchResult[] {
  const titleKeyFor = (entry: ActionEntry) =>
    entry.action.kind === 'toggleBalances' && options.balancesHidden ? 'dashboard.showBalances' : entry.titleKey;
  return rank(ACTION_INDEX, query, options, titleKeyFor).map(({ entry, title, score }) => ({
    type: 'action' as const,
    id: `action-${entry.id}`,
    title,
    subtitle: '',
    icon: entry.action.kind === 'toggleBalances' && options.balancesHidden ? 'mdi-eye-outline' : entry.icon,
    data: { action: entry.action },
    _score: score,
  }));
}

/**
 * Settings rows matching `query`. Selected by opening `SettingsDialog` on
 * `data.tab`. Two entries can lead to the same row under different keywords
 * (PassKey and lock settings share one); only the better-scoring one is kept,
 * since the id doubles as the list key.
 */
export function settingResults(query: string, options: IndexOptions): SearchResult[] {
  const { t } = options;
  const seen = new Set<string>();
  return rank(SETTINGS_INDEX, query, options)
    .filter(({ entry }) => {
      const id = `${entry.tab}-${entry.titleKey}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(({ entry, title, score }) => ({
    type: 'setting' as const,
    id: `setting-${entry.tab}-${entry.titleKey}`,
    title,
    subtitle: `${String(t('common.settings'))} → ${String(t(entry.subtitleKey))}`,
    icon: entry.icon,
    data: { tab: entry.tab, highlight: title },
    _score: score,
  }));
}
