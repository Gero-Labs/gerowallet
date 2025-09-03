import { reactive, computed } from 'vue';
import cardStore from './card';

// Define the possible wallet status states
export type WalletStatusState = 'auth' | 'new' | 'pending' | 'approved' | 'loading';

// Define KYC status types
export type KYCStatus = 'not_started' | 'pending' | 'approved' | 'rejected' | 'expired';

// Define authentication status types
export type AuthStatus = 'unauthenticated' | 'authenticated' | 'expired';

interface WalletStatusStore {
  // Current state
  currentState: WalletStatusState;
  
  // Authentication status
  authStatus: AuthStatus;
  isKaiserexAuthenticated: boolean;
  
  // KYC status
  kycStatus: KYCStatus;
  kycData: {
    submittedAt?: string;
    approvedAt?: string;
    rejectedAt?: string;
    expiresAt?: string;
    rejectionReason?: string;
  } | null;
  
  // Loading states
  isLoading: boolean;
  loadingMessage: string;
  
  // Error states
  error: string | null;
}

// Create reactive store
const walletStatusStore = reactive<WalletStatusStore>({
  currentState: 'loading',
  authStatus: 'unauthenticated',
  isKaiserexAuthenticated: false,
  kycStatus: 'not_started',
  kycData: null,
  isLoading: false,
  loadingMessage: '',
  error: null,
});

/**
 * Core wallet state determination logic
 * 
 * Business Rules:
 * 1. No Kaiserex token → Authentication required
 * 2. Has token + KYC not_started → Order card flow
 * 3. Has token + KYC pending → Wait for approval
 * 4. Has token + KYC approved → Full access
 * 5. Has token + KYC rejected → Re-authentication
 */
const computedState = computed((): WalletStatusState => {
  const { isKaiserexAuthenticated, kycStatus, isLoading } = walletStatusStore;
  
  // System loading state
  if (isLoading) {
    return 'loading';
  }

  // Rule 1: Authentication gate - no token means no access
  const hasValidToken = isKaiserexAuthenticated && walletStatusStore.authStatus === 'authenticated';
  if (!hasValidToken) {
    return 'auth'; // → KaiserexAuthPage
  }

  // User is authenticated, determine flow based on KYC status
  switch (kycStatus) {
    case 'not_started':
      // Rule 2: Token exists but KYC process not initiated
      return 'new'; // → OrderCardSection
      
    case 'pending': 
      // Rule 3: KYC submitted, waiting for approval
      return 'pending'; // → PendingSection
      
    case 'approved':
      // Rule 4: KYC approved, full wallet access
      return 'approved'; // → HomeSection
      
    case 'rejected':
    case 'expired':
      // Rule 5: KYC failed or expired, need re-authentication
      return 'auth'; // → KaiserexAuthPage (with error context)
      
    default:
      // Fallback: treat unknown status as not started
      return 'new';
  }
});

// Actions
const walletStatusActions = {
  /**
   * Initialize the wallet status from localStorage and API
   */
  async initialize(): Promise<void> {
    walletStatusStore.isLoading = true;
    walletStatusStore.loadingMessage = 'Checking authentication status...';
    walletStatusStore.error = null;

    try {
      // Check Kaiserex authentication
      const kaiserexAuth = localStorage.getItem('kaiserexRegistered') === 'true';
      walletStatusStore.isKaiserexAuthenticated = kaiserexAuth;
      walletStatusStore.authStatus = kaiserexAuth ? 'authenticated' : 'unauthenticated';

      // Check KYC status
      const storedKycStatus = localStorage.getItem('kycStatus') as KYCStatus;
      if (storedKycStatus) {
        walletStatusStore.kycStatus = storedKycStatus;
        // KYC status loaded from localStorage
      } else {
        // No KYC status found in localStorage
      }

      // Load KYC data from localStorage
      const storedKycData = localStorage.getItem('kycData');
      if (storedKycData) {
        walletStatusStore.kycData = JSON.parse(storedKycData);
      }

      // Update current state based on computed logic
      walletStatusStore.currentState = computedState.value;

    } catch (error) {
      console.error('Failed to initialize wallet status:', error);
      walletStatusStore.error = 'Failed to load authentication status';
      walletStatusStore.currentState = 'auth';
    } finally {
      walletStatusStore.isLoading = false;
      walletStatusStore.loadingMessage = '';
    }
  },

  /**
   * Set Kaiserex authentication status
   */
  setKaiserexAuthentication(isAuthenticated: boolean): void {
    walletStatusStore.isKaiserexAuthenticated = isAuthenticated;
    walletStatusStore.authStatus = isAuthenticated ? 'authenticated' : 'unauthenticated';
    
    // Persist to localStorage
    if (isAuthenticated) {
      localStorage.setItem('kaiserexRegistered', 'true');
    } else {
      localStorage.removeItem('kaiserexRegistered');
    }

    // Update current state
    walletStatusStore.currentState = computedState.value;
  },

  /**
   * Update KYC status
   */
  setKYCStatus(status: KYCStatus, data?: Partial<WalletStatusStore['kycData']>): void {
    walletStatusStore.kycStatus = status;
    
    // Update KYC data
    if (data) {
      walletStatusStore.kycData = {
        ...walletStatusStore.kycData,
        ...data,
      };
    }

    // Set timestamps based on status
    const timestamp = new Date().toISOString();
    switch (status) {
      case 'pending':
        if (!walletStatusStore.kycData?.submittedAt) {
          walletStatusStore.kycData = {
            ...walletStatusStore.kycData,
            submittedAt: timestamp,
          };
        }
        break;
      case 'approved':
        walletStatusStore.kycData = {
          ...walletStatusStore.kycData,
          approvedAt: timestamp,
        };
        break;
      case 'rejected':
        walletStatusStore.kycData = {
          ...walletStatusStore.kycData,
          rejectedAt: timestamp,
        };
        break;
    }

    // Persist to localStorage
    localStorage.setItem('kycStatus', status);
    if (walletStatusStore.kycData) {
      localStorage.setItem('kycData', JSON.stringify(walletStatusStore.kycData));
    }

    // Update current state
    walletStatusStore.currentState = computedState.value;
  },

  /**
   * Set loading state
   */
  setLoading(isLoading: boolean, message: string = ''): void {
    walletStatusStore.isLoading = isLoading;
    walletStatusStore.loadingMessage = message;
    
    if (isLoading) {
      walletStatusStore.currentState = 'loading';
    } else {
      walletStatusStore.currentState = computedState.value;
    }
  },

  /**
   * Set error state
   */
  setError(error: string | null): void {
    walletStatusStore.error = error;
  },

  /**
   * Clear all data (logout)
   */
  clearAll(): void {
    walletStatusStore.currentState = 'auth';
    walletStatusStore.authStatus = 'unauthenticated';
    walletStatusStore.isKaiserexAuthenticated = false;
    walletStatusStore.kycStatus = 'not_started';
    walletStatusStore.kycData = null;
    walletStatusStore.isLoading = false;
    walletStatusStore.loadingMessage = '';
    walletStatusStore.error = null;

    // Clear localStorage
    localStorage.removeItem('kaiserexRegistered');
    localStorage.removeItem('kycStatus');
    localStorage.removeItem('kycData');
  },

  /**
   * Force update current state (useful for development)
   */
  forceState(state: WalletStatusState): void {
    if (import.meta.env.DEV) {
      walletStatusStore.currentState = state;
    }
  },

  /**
   * Check if user can proceed to next step
   */
  canProceedToNext(): boolean {
    switch (walletStatusStore.currentState) {
      case 'auth':
        return walletStatusStore.isKaiserexAuthenticated;
      case 'new':
        return !!cardStore.state.userInfo;
      case 'pending':
        return walletStatusStore.kycStatus === 'approved';
      case 'approved':
        return true;
      default:
        return false;
    }
  },

  /**
   * Get next required action for user
   */
  getNextAction(): string {
    switch (walletStatusStore.currentState) {
      case 'auth':
        return 'Complete Kaiserex authentication';
      case 'new':
        return 'Complete account setup';
      case 'pending':
        return walletStatusStore.kycStatus === 'not_started' 
          ? 'Complete KYC verification' 
          : 'Wait for KYC approval';
      case 'approved':
        return 'Enjoy your Gero Card!';
      default:
        return 'Loading...';
    }
  },
};

// Export store and actions
export default {
  state: walletStatusStore,
  computed: {
    currentState: computedState,
  },
  actions: walletStatusActions,
};

// Types are already exported above, no need to re-export
