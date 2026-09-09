import ledgerSvg from '@/assets/svg/ledger.svg';
import keystoneSvg from '@/assets/svg/keystone.svg';
import trezorSvg from '@/assets/svg/trezor.svg';
import googleSvg from '@/assets/svg/googleWhite.svg';
import geroLogo from '@/assets/svg/gero-logo.svg';

export default {
  ledgerSvg, keystoneSvg, trezorSvg, googleSvg, geroLogo,
  resolveIcon(icon: string) { return `/src/assets/svg/${icon || 'blue'}.svg`; },
};

export { default as geroDashboard } from '@/assets/svg/gero_dashboard.svg';
export { default as geroDashboardApex } from '@/assets/svg/gero_dashboard_apex.svg';
export { default as geroDashboardPrime } from '@/assets/svg/gero_dashboard_prime.svg';
export { default as geroDashboardVector } from '@/assets/svg/gero_dashboard_vector.svg';
export { default as geroDashboardBitcoin } from '@/assets/svg/gero_dashboard_bitcoin.svg';
