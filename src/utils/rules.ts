import { Blockchain, Network } from '@/models/types';
import { isPaymentAddress } from '@/chrome/serialization';
import i18n from '@/plugins/i18n';

export default {
  name: (value: string) => {
    return /^[\p{L} ,.'-]+$/u.test(value) || (i18n.t('common.invalidName') as string);
  },
  minCharacters: (min: number) => {
    return (value: string) => value.length >= min || (i18n.t('common.minimumCharacters', { min }) as string);
  },
  oneOrMoreNumbers: (value: string) => {
    return /\d/.test(value) || (i18n.t('common.oneOrMoreNumbersRequired') as string);
  },
  containCapital: (value: string) => {
    return /[A-Z]/.test(value) || (i18n.t('common.shouldContainCapital') as string);
  },
  containLowerCase: (value: string) => {
    return /[a-z]/.test(value) || (i18n.t('common.shouldContainLowerCase') as string);
  },
  spaceNotAllowed: (value: string) => {
    return !/\s/.test(value) || (i18n.t('common.shouldNotContainSpace') as string);
  },
  containSpecialCharacter: (value: string) => {
    return /[`!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/.test(value) || (i18n.t('common.shouldContainSpecialChar') as string);
  },
  maxCharacters: (max: number) => {
    return (value: string) => value.length <= max || (i18n.t('common.maxCharacters', { max }) as string);
  },
  required: () => {
    return (value: string) => !!value || (i18n.t('common.fieldRequired') as string);
  },
  recipientRules(chain: string, network: string) {
    if (network === Network.MAINNET) {
      if (chain === Blockchain.CARDANO) {
        return (value: string) => (value && (isPaymentAddress(value) || (value.startsWith('$') && value.length > 1))) || (i18n.t('common.invalidPaymentAddress') as string);
      } else {
        return (value: string) => (value && isPaymentAddress(value)) || (i18n.t('common.invalidPaymentAddress') as string);
      }
    } else {
      return (value: string) => (value && isPaymentAddress(value)) || (i18n.t('common.invalidPaymentAddress') as string);
    }
  },
  paymentAddress: (test: Boolean) => {
    return (value: string) => (test ? value.startsWith('addr_test1') : value.startsWith('addr1') || value.startsWith('DdzFF')) || (i18n.t('common.invalidPaymentAddress') as string);
  },
  paymentAddressOrAdaHandle: () => {
    return (value: string) => (value && (value.startsWith('addr1') || value.startsWith('DdzFF') || (value.startsWith('$') && value.length > 1))) || (i18n.t('common.invalidPaymentAddress') as string);
  },
};
