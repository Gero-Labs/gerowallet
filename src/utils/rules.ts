import { Blockchain, Network } from '@/models/types';
import { isPaymentAddress } from '@/chrome/serialization';

export default {
  name: (value: string) => {
    return /^[\p{L} ,.'-]+$/u.test(value) || 'Invalid Name';
  },
  minCharacters: (min: number) => {
    return (value: string) => value.length >= min || `Minimum of ${min} characters`;
  },
  oneOrMoreNumbers: (value: string) => {
    return /\d/.test(value) || 'One or more numbers are required';
  },
  containCapital: (value: string) => {
    return /[A-Z]/.test(value) || 'Should contain one or more capital letters';
  },
  containLowerCase: (value: string) => {
    return /[a-z]/.test(value) || 'Should contain one or more lower case letters';
  },
  spaceNotAllowed: (value: string) => {
    return !/\s/.test(value) || "Should not contain the 'space' character";
  },
  containSpecialCharacter: (value: string) => {
    return /[`!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/.test(value) || 'Should contain one or more special characters';
  },
  maxCharacters: (max: number) => {
    return (value: string) => value.length <= max || `Max ${max} characters`;
  },
  required: () => {
    return (value: string) => !!value || 'Field is required';
  },
  recipientRules(chain: string, network: string) {
    if (network === Network.MAINNET) {
      if (chain === Blockchain.CARDANO) {
        return (value: string) => (value && (isPaymentAddress(value) || (value.startsWith('$') && value.length > 1))) || 'Invalid Payment Address';
      } else {
        return (value: string) => (value && isPaymentAddress(value)) || 'Invalid Payment Address';
      }
    } else {
      return (value: string) => (value && isPaymentAddress(value)) || 'Invalid Payment Address';
    }
  }
};
