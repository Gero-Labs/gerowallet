import { Cardano } from '@cardano-sdk/core';
import { StoredTransaction, isCardanoTx } from '@/models/transaction.types';

type Translator = (key: string, params?: Record<string, unknown>) => string;

export const getCertificateBaseStatus = (
  certificateType: string,
  t: Translator,
): string => {
  switch (certificateType) {
    case Cardano.CertificateType.StakeRegistrationDelegation:
    case Cardano.CertificateType.StakeDelegation:
      return t('transactions.delegatingToPool');
    case Cardano.CertificateType.Unregistration:
    case Cardano.CertificateType.StakeDeregistration:
      return t('transactions.stakeDeregistration');
    case Cardano.CertificateType.RegisterDelegateRepresentative:
      return t('dashboard.dRepRegistration');
    case Cardano.CertificateType.VoteDelegation:
      return t('transactions.voteDelegation');
    case Cardano.CertificateType.VoteRegistrationDelegation:
      return t('transactions.voteRegistrationDelegation');
    case Cardano.CertificateType.StakeVoteRegistrationDelegation:
      return t('transactions.stakeVoteRegistration');
    case Cardano.CertificateType.UnregisterDelegateRepresentative:
      return t('dashboard.dRepDeregistration');
    default:
      return '';
  }
};

const addFundTransferStatus = (
  item: StoredTransaction,
  statuses: string[],
  t: Translator,
): void => {
  if (isCardanoTx(item) && item.body?.certificates && item.body.certificates.length > 0) {
    return;
  }
  const hasReceivedFunds = item.receivedAmount - item.sentAmount > 0;
  const hasSentFunds = item.receivedAmount - item.sentAmount < 0;
  const hasReceivedTokens = item.assets?.some((asset) => asset.unit !== 'lovelace' && asset.quantity > 0);
  const hasSentTokens = item.assets?.some((asset) => asset.unit !== 'lovelace' && asset.quantity < 0);

  if (hasReceivedFunds && hasReceivedTokens) {
    statuses.push(t('transactions.receivedFundsAndTokens'));
  } else if (hasSentFunds && hasSentTokens) {
    statuses.push(t('transactions.sentFundsAndTokens'));
  } else if (hasReceivedFunds && hasSentTokens) {
    statuses.push(t('transactions.receivedFundsAndSentTokens'));
  } else if (hasSentFunds && hasReceivedTokens) {
    statuses.push(t('transactions.sentFundsAndReceivedTokens'));
  } else if (hasReceivedFunds) {
    statuses.push(t('transactions.receivedFunds'));
  } else if (hasSentFunds) {
    statuses.push(t('transactions.sentFunds'));
  } else if (hasReceivedTokens) {
    statuses.push(t('transactions.receivedTokens'));
  } else if (hasSentTokens) {
    statuses.push(t('transactions.sentTokens'));
  }
};

export const buildBasicStatus = (item: StoredTransaction, t: Translator): string => {
  const statuses: string[] = [];

  if (item.type) {
    switch (item.type) {
      case 'receive':
        return t('transactions.receivedFunds');
      case 'send':
        return t('transactions.sentFunds');
      case 'self':
        return t('transactions.selfTransfer');
      default:
        return t('transactions.transaction');
    }
  }

  if (isCardanoTx(item) && item.body?.certificates?.length > 0) {
    item.body.certificates.forEach((certificate: Cardano.Certificate) => {
      const status = getCertificateBaseStatus(certificate.__typename, t);
      if (status) statuses.push(status);
    });
  }

  addFundTransferStatus(item, statuses, t);
  return statuses.join(', ');
};

export const getTransactionColor = (item: StoredTransaction): string => {
  if (item.pending) return '#FEC84B';
  if (item.ada > 0) return '#47cd89';
  if (item.ada < 0) return '#F97066';
  return '';
};
