

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
import barChart from '@/assets/svg/bar-chart-07.svg'
import coinsStacked from '@/assets/svg/coins-stacked-02.svg'
import blog from '@/assets/svg/blog.svg'
import mediaPlayer from '@/assets/svg/play-square.svg'
import cashback from '@/assets/svg/cashback.svg'
import governance from '@/assets/svg/governance.svg'
import transactions from '@/assets/svg/transaction.svg'
import market from '@/assets/svg/finance.svg'
import zkFiat from '@/assets/svg/euro.svg'
import infinity from '@/assets/svg/infinity.svg'
import usersPlus from '@/assets/svg/users-plus.svg'
import logout from '@/assets/svg/log-out-01.svg'
import walletSvg from '@/assets/svg/wallet.svg'
import settingsSvg from '@/assets/svg/settings.svg'
import arrowRightSvg from '@/assets/svg/arrow-right.svg'
import trendUpSvg from '@/assets/svg/trend-up.svg'
import trendDownSvg from '@/assets/svg/trend-down.svg'
import xSvg from '@/assets/svg/x.svg'
import discordSvg from '@/assets/svg/discord.svg'
import telegramSvg from '@/assets/svg/telegram.svg'
import dollarShieldSvg from '@/assets/svg/dollar-shield.svg'
import swapSvg from '@/assets/svg/swap.svg'
import qrCodeSvg from '@/assets/svg/qr-code.svg'
import sendSvg from '@/assets/svg/send.svg'

import cardanoBackground from '@/assets/cardanoBg.png'
import geroLogoApex from '@/modules/navigation/assets/gero_logo_apex.png'
import cardanoShieldLogo from '@/assets/svg/cardano_shield_logo.svg'
import geroLogo from '@/assets/svg/gero-logo.svg'
import geroText from '@/assets/svg/gero-text.svg'
import apexBackground from '@/assets/background2.png'
import guardarian from '@/modules/dashboard/assets/guardarian.svg'
import moonpay from '@/modules/dashboard/assets/moonpay.svg'



import manifest from '@/manifest.json'

export default {
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

  cardanoShieldLogo,
  geroLogo,
  geroText,
  apexBackground,
  cardanoBackground,
  geroLogoApex,
  guardarian,
  moonpay,
  resolveIcon(icon: string): string {
    if (icon === 'green' || icon === 'teal') {
      return greenSvg
    } else if (icon === 'purple' || icon === 'deep-purple') {
      return purpleSvg
    } else if (icon === 'pink') {
      return pinkSvg
    } else if (icon === 'orange' || icon === 'chocolate') {
      return orangeSvg
    } else if (icon === 'blue' || icon === 'cyan') {
      return blueSvg
    } else if (icon === 'grey') {
      return greySvg
    } else {
      return ''
    }
  },
  resolveRisk(icon: string): string {
    if (icon === 'green') {
      return greenSvg
    } else if (icon === 'purple') {
      return purpleSvg
    } else if (icon === 'pink') {
      return pinkSvg
    } else if (icon === 'orange') {
      return orangeSvg
    } else if (icon === 'blue') {
      return blueSvg
    } else if (icon === 'grey') {
      return greySvg
    }
    return ''
  },
  manifest
}
