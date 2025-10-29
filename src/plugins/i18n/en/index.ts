import { en } from 'vuetify/src/locale'
import common from './common'
import wallet from './wallet'
import dashboard from './dashboard'
import navigation from './navigation'
import staking from './staking'
import swap from './swap'
import governance from './governance'
import assets from './assets'
import cashback from './cashback'
import multisig from './multisig'
import welcome from './welcome'
import settings from './settings'
import card from './card'
import perpetuals from './perpetuals'
import transactions from './transactions'
import blog from './blog'
import emptyState from './emptyState'

export default {
  rtl: 'false',
  locale: 'en-US',
  $vuetify: { ...en },
  common,
  wallet,
  dashboard,
  navigation,
  staking,
  swap,
  governance,
  assets,
  cashback,
  multisig,
  welcome,
  settings,
  card,
  perpetuals,
  transactions,
  blog,
  emptyState,
}

