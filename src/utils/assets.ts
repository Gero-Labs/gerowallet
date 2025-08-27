import { CID } from 'multiformats/cid'
import apexBg from '@/assets/apex.png'
import walletCreateBg from '@/modules/welcome/assets/wallet_new.png'
import walletRestoreBg from '@/modules/welcome/assets/wallet_restore.png'
import hardwareWalletBg from '@/modules/welcome/assets/hardware_wallet.png'
import walletCreateApexBg from '@/modules/welcome/assets/wallet_new_apex.png'
import walletRestoreApexBg from '@/modules/welcome/assets/wallet_restore_apex.png'
import hardwareWalletApexBg from '@/modules/welcome/assets/hardware_wallet_apex.png'
import greenSvg from '@/assets/svg/green.svg'
import purpleSvg from '@/assets/svg/purple.svg'
import pinkSvg from '@/assets/svg/pink.svg'
import orangeSvg from '@/assets/svg/orange.svg'
import blueSvg from '@/assets/svg/blue.svg'
import greySvg from '@/assets/svg/grey.svg'
import ledgerSvg from '@/assets/svg/ledger.svg'
import keystoneSvg from '@/assets/svg/keystone.svg'
import ledgerLogoSvg from '@/assets/svg/ledger-logo.svg'
import trezorLogoSvg from '@/assets/svg/trezor-logo.svg'
import keystoneLogoSvg from '@/assets/svg/keystone-logo.svg'
import connectLedgerSvg from '@/assets/svg/connect_ledger.svg'
import connectTrezorSvg from '@/assets/svg/connect_trezor.svg'
import connectKeystoneSvg from '@/assets/svg/connect_keystone.svg'
import loadingAnimation from '@/assets/webm/loading.webm'
import errorImage from '@/assets/img/1x1.png'
import geroDashboard from '@/assets/svg/gero_dashboard.svg'
import geroDashboardApex from '@/assets/svg/gero_dashboard_apex.svg'
import barChart from '@/assets/svg/bar-chart-07.svg'
import coinsStacked from '@/assets/svg/coins-stacked-02.svg'
import blog from '@/assets/svg/blog.svg'
import mediaPlayer from '@/assets/svg/play-square.svg'
import cashback from '@/assets/svg/cashback.svg'
import governance from '@/assets/svg/governance.svg'
import dao from '@/assets/svg/dao.svg'
import transactions from '@/assets/svg/transaction.svg'
import market from '@/assets/svg/finance.svg'
import zkFiat from '@/assets/svg/euro.svg'
import infinity from '@/assets/svg/infinity.svg'
import usersPlus from '@/assets/svg/users-plus.svg'
import logout from '@/assets/svg/log-out-01.svg'
import walletSvg from '@/assets/svg/wallet.svg'
import settingsSvg from '@/assets/svg/settings-02.svg'
import arrowRightSvg from '@/assets/svg/arrow-right.svg'
import trendUpSvg from '@/assets/svg/trend-up-01.svg'
import trendDownSvg from '@/assets/svg/trend-down-01.svg'
import xSvg from '@/assets/svg/x.svg'
import discordSvg from '@/assets/svg/discord.svg'
import telegramSvg from '@/assets/svg/telegram.svg'
import dollarShieldSvg from '@/assets/svg/dollar-shield.svg'
import swapSvg from '@/assets/svg/swap.svg'
import qrCodeSvg from '@/assets/svg/qr-code.svg'
import sendSvg from '@/assets/svg/send.svg'
import multisigTree from '@/assets/svg/multisig-tree.svg'
import multisigPaid from '@/assets/svg/multisig_paid.svg'
import multisigPending from '@/assets/svg/multisig_pending.svg'
import multisigDollar from '@/assets/svg/multisig_dollar.svg'
import multisigExpired from '@/assets/svg/multisig_expired.svg'
import multisigTotal from '@/assets/svg/multisig_stack.svg'
import detailsSvg from '@/assets/svg/details.svg'
import depositSvg from '@/assets/svg/deposit.svg'
import cardanoBackground from '@/assets/cardanoBg.png'
import cardanoShieldLogo from '@/assets/svg/cardano_shield_logo.svg'
import cardanoShieldBigLogo from '@/assets/img/cardano-shield/logo.png'
import geroLogo from '@/assets/svg/gero-logo.svg'
import geroDashboardText from '@/assets/gero-dashboard.svg'
import geroText from '@/assets/svg/gero-text.svg'
import apexBackground from '@/assets/background2.png'
import guardarian from '@/modules/dashboard/assets/guardarian.svg'
import moonpay from '@/modules/dashboard/assets/moonpay.svg'
import welcomeImage from '@/shared/assets/welcome/welcome.png'
import improvedUxSS from '@/shared/assets/welcome/improved_ux.png'
import geroCardSS from '@/shared/assets/welcome/gero_card.png'
import perpetualsSS from '@/shared/assets/welcome/perpetuals.png'
import multisigSS from '@/shared/assets/welcome/multisig.png'
import cashbackNewSS from '@/shared/assets/welcome/cashback_new.png'
import riskLow from '@/assets/img/cardano-shield/risk-low.svg'
import riskMedium from '@/assets/img/cardano-shield/risk-medium.svg'
import riskHigh from '@/assets/img/cardano-shield/risk-high.svg'
import riskUnknown from '@/assets/img/cardano-shield/risk-unknown.svg'
import dappRiskSafe from '@/assets/img/cardano-shield/dapp-safe.png'
import dappRiskPhishing from '@/assets/img/cardano-shield/dapp-phishing.png'
import dappRiskSuspicious from '@/assets/img/cardano-shield/dapp-suspicious.png'
import dappRiskTimeout from '@/assets/img/cardano-shield/dapp-timeout.png'
import dappRiskUnknown from '@/assets/img/cardano-shield/dapp-unknown.png'
import giftSvg from '@/assets/svg/gift.svg'
import pendingSvg from '@/assets/svg/pending.svg'
import piggyBankSvg from '@/assets/svg/piggybank.svg'
import withdrawalSvg from '@/assets/svg/withdrawal.svg'
import riskA from '@/assets/svg/risk/A.svg'
import riskAA from '@/assets/svg/risk/AA.svg'
import riskAAA from '@/assets/svg/risk/AAA.svg'
import riskB from '@/assets/svg/risk/B.svg'
import riskBB from '@/assets/svg/risk/BB.svg'
import riskBBB from '@/assets/svg/risk/BBB.svg'
import riskC from '@/assets/svg/risk/C.svg'
import riskCC from '@/assets/svg/risk/CC.svg'
import riskCCC from '@/assets/svg/risk/CCC.svg'
import riskD from '@/assets/svg/risk/D.svg'
import buyAda from '@/modules/dashboard/assets/buy-ada.png'
import sellAda from '@/modules/dashboard/assets/sell-ada.png'
import { DappRisk, DappScore } from '@/models/cardano-shield-types';
import google from '@/assets/svg/google.svg';
import googleSvg from '@/assets/svg/googleWhite.svg'
import zkFold from '@/assets/svg/zkfold.svg';
import cashbackBags from '@/assets/img/cashback.png';
import cardanoBg from '@/assets/cardanoBg.png';
import cashbackBg from '@/assets/cashbackBg.png';
import rectangle from '@/assets/img/rectangle.png';
import rectangle2 from '@/assets/img/rectangle2.png';
import walletGeroSvg from '@/assets/svg/walletGero.svg';
import walletGeroApexSvg from '@/assets/svg/walletGeroApex.svg';
import keySvg from '@/assets/svg/key.svg';
import keyApexSvg from '@/assets/svg/keyApex.svg';
import pairSvg from '@/assets/svg/pair.svg';
import pairApexSvg from '@/assets/svg/pairApex.svg';
import cardanoSvg from '@/assets/svg/cardano.svg';
import clarityLogo from '@/assets/img/clarityLogo.png';
import questionMark from '@/assets/svg/question-mark.svg'
import questionMarkDark from '@/assets/svg/question-mark-dark.svg'
import midnightImage from '@/assets/Midnight.png'
import logoStackedLight from '@/assets/logo-stacked-light.svg'
import apexBgDashboard from '@/assets/apexBg.png'
import apexImage from '@/assets/apex.png'
import apexSvg from '@/assets/svg/ap3x.svg'
import walletGeroApex from '@/assets/svg/walletGeroApex.svg'
import debitCardBgImage from '@/assets/debitcardbg.png'
import cashbackCarouselImage from '@/assets/cashbackcarousel.png'
import cashbackImage from '@/assets/cashback.png'
import debitCardImage from '@/assets/geroCard.png'
import frontCardNoMcx2 from '@/assets/front_card_no_mcx2.png'
import emptyState from '@/assets/emptyState.png'
import card from '@/assets/svg/card.svg'
import bringWhite from '@/assets/svg/bring-white.svg'

const baseUrl = import.meta.env['VITE_BACKEND_URL'];

export default {
  apexBg,
  walletCreateBg,
  walletRestoreBg,
  hardwareWalletBg,
  walletCreateApexBg,
  walletRestoreApexBg,
  hardwareWalletApexBg,
  greenSvg,
  purpleSvg,
  pinkSvg,
  orangeSvg,
  blueSvg,
  greySvg,
  ledgerSvg,
  keystoneSvg,
  ledgerLogoSvg,
  trezorLogoSvg,
  keystoneLogoSvg,
  connectLedgerSvg,
  connectTrezorSvg,
  connectKeystoneSvg,
  loadingAnimation,
  errorImage,
  geroDashboard,
  barChart,
  coinsStacked,
  blog,
  mediaPlayer,
  cashback,
  governance,
  transactions,
  market,
  zkFiat,
  infinity,
  usersPlus,
  logout,
  walletSvg,
  settingsSvg,
  arrowRightSvg,
  trendUpSvg,
  trendDownSvg,
  xSvg,
  discordSvg,
  telegramSvg,
  dollarShieldSvg,
  swapSvg,
  qrCodeSvg,
  sendSvg,
  multisigTree,
  multisigPaid,
  multisigPending,
  multisigDollar,
  multisigExpired,
  multisigTotal,
  detailsSvg,
  depositSvg,
  cardanoShieldLogo,
  cardanoShieldBigLogo,
  geroLogo,
  geroDashboardText,
  geroText,
  apexBackground,
  cardanoBackground,
  geroDashboardApex,
  guardarian,
  moonpay,
  welcomeImage,
  dao,
  improvedUxSS,
  geroCardSS,
  perpetualsSS,
  multisigSS,
  cashbackNewSS,
  giftSvg,
  pendingSvg,
  piggyBankSvg,
  withdrawalSvg,
  buyAda,
  sellAda,
  card,
  bringWhite,
  detectCIDVersion(cidStr: string) {
    try {
      const cid = CID.parse(cidStr);
      return cid.version; // 0, 1, or 2
    } catch (e) {
      return null; // Not a valid CID
    }
  },
  resolveIcon(icon: string): string {
    if (!icon) {
      return errorImage;
    }

    if (icon.startsWith('http') || icon.startsWith('data:')) {
      return icon;
    } else if (icon.startsWith('ar://') || icon.startsWith('ar/')) {
      return `${baseUrl}/api/ar/${icon.replace('ar://', '').replace('ar/', '')}`
    } else if (icon.startsWith('ipfs://') || icon.startsWith('ipfs/')) {
      return `${baseUrl}/api/ipfs?path=${icon.replace('ipfs://', '').replace('ipfs/', '')}`
    } else if (this.detectCIDVersion(icon) != null) {
      return `${baseUrl}/api/ipfs?path=${icon}`
    }

    switch (icon) {
      case 'green':
      case 'teal':
        return greenSvg;
      case 'purple':
      case 'deep-purple':
        return purpleSvg;
      case 'pink':
        return pinkSvg;
      case 'orange':
      case 'chocolate':
        return orangeSvg;
      case 'blue':
      case 'cyan':
        return blueSvg;
      case 'grey':
        return greySvg;
    }

    const firstChar = icon.charAt(0);

    let mimeType: string | null = null;

    switch (firstChar) {
      case '/':
        mimeType = 'image/jpeg';
        break;
      case 'i':
        mimeType = 'image/png';
        break;
      case 'R':
        mimeType = 'image/gif';
        break;
      case 'U':
        mimeType = 'image/webp';
        break;
      default:
        return errorImage;
    }

    return `data:${mimeType};base64,${icon}`;
  },
  fallbackImage(e) {
    if (e && e.target) {
      e.target.src = this.errorImage
    }
  },
  resolveRisk(risk: string): string {
    if (risk === 'A') {
      return riskA
    } else if (risk === 'AA') {
      return riskAA
    } else if (risk === 'AAA') {
      return riskAAA
    } else if (risk === 'B') {
      return riskB
    } else if (risk === 'BB') {
      return riskBB
    } else if (risk === 'BBB') {
      return riskBBB
    } else if (risk === 'C') {
      return riskC
    } else if (risk === 'CC') {
      return riskCC
    } else if (risk === 'CCC') {
      return riskCCC
    } else if (risk === 'D') {
      return riskD
    }
    return errorImage
  },
  resolveDappRisk(risk: number): string {
    switch (risk) {
      case DappRisk.whitelist:
        return dappRiskSafe;
      case DappRisk.blacklist:
        return dappRiskPhishing;
      case DappRisk.suspicious:
        return dappRiskSuspicious;
      case DappRisk.timeout:
        return dappRiskTimeout;
      case DappRisk.unknown:
      default:
        return dappRiskUnknown;
    }
  },
  resolveCardanoShieldRisk(risk: string): string {
    switch (DappScore[risk]) {
      case DappScore.low:
        return riskLow;
      case DappScore.medium:
        return riskMedium;
      case DappScore.high:
        return riskHigh;
      default:
        return riskUnknown;
    }
  },
  google,
  googleSvg,
  zkFold,
  cashbackBags,
  cardanoBg,
  cashbackBg,
  rectangle,
  rectangle2,
  walletGeroSvg,
  walletGeroApexSvg,
  keySvg,
  keyApexSvg,
  pairSvg,
  pairApexSvg,
  cardanoSvg,
  clarityLogo,
  questionMark,
  questionMarkDark,
  midnightImage,
  logoStackedLight,
  apexBgDashboard,
  apexImage,
  apexSvg,
  walletGeroApex,
  debitCardBgImage,
  cashbackCarouselImage,
  cashbackImage,
  debitCardImage,
  frontCardNoMcx2,
  emptyState
}

export {
  geroDashboardApex,
  geroDashboard,
  google,
  zkFold
}