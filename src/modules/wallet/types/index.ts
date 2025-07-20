// Wallet Module Types

// Component Props Types
export interface ButtonProps {
  text: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}

export interface FeatureCardProps {
  icon: 'conversion' | 'global' | 'track';
  title: string;
  description: string;
}

export interface FeatureListItemProps {
  text: string;
  icon?: string;
}

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
}

// KYC Types
export interface KYCData {
  idFile?: File;
  photoFile?: File;
  step: number;
  isComplete: boolean;
}

export interface KYCModalProps extends ModalProps {
  onComplete: (data: KYCData) => void;
}

// Card Types
export interface CardApplication {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'shipped';
  createdAt: Date;
  updatedAt: Date;
}

export interface CardBenefits {
  id: string;
  title: string;
  description: string;
  icon: string;
}

// Section Types
export interface SectionProps {
  className?: string;
  children?: any;
}

// Event Types
export interface WalletEvents {
  'card-ordered': CardApplication;
  'kyc-completed': KYCData;
  'modal-closed': void;
} 