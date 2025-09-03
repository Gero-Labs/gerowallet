import { computed, watch, onMounted } from 'vue';
import walletStatusStore, { type WalletStatusState, type KYCStatus } from '@/stores/modules/walletStatus';
import cardStore from '@/stores/modules/card';

/**
 * Composable for managing wallet authentication and KYC status
 * Integrates with existing card store for seamless state management
 */
export function useWalletStatus() {
  // Reactive state from wallet status store
  const currentState = computed(() => walletStatusStore.computed.currentState.value);
  const isLoading = computed(() => walletStatusStore.state.isLoading);
  const error = computed(() => walletStatusStore.state.error);
  const kycStatus = computed(() => walletStatusStore.state.kycStatus);
  const isKaiserexAuthenticated = computed(() => walletStatusStore.state.isKaiserexAuthenticated);

  // Card store integration
  const isCardAuthenticated = computed(() => cardStore.isAuthenticated);
  const hasUserInfo = computed(() => !!cardStore.state.userInfo);
  const hasCardData = computed(() => !!cardStore.state.cardData);
  const cardLoading = computed(() => cardStore.state.loading);

  // Combined status checks
  const canProceedToNext = computed(() => walletStatusStore.actions.canProceedToNext());
  const nextAction = computed(() => walletStatusStore.actions.getNextAction());

  // State-specific computed properties
  const showAuthPage = computed(() => currentState.value === 'auth');
  const showNewUserFlow = computed(() => currentState.value === 'new');
  const showPendingKYC = computed(() => currentState.value === 'pending');
  const showApprovedHome = computed(() => currentState.value === 'approved');
  const showLoading = computed(() => currentState.value === 'loading' || isLoading.value);

  // Actions
  const initialize = async () => {
    await walletStatusStore.actions.initialize();
  };

  const setKaiserexAuthentication = (isAuthenticated: boolean) => {
    walletStatusStore.actions.setKaiserexAuthentication(isAuthenticated);
  };

  const setKYCStatus = (status: KYCStatus, data?: any) => {
    walletStatusStore.actions.setKYCStatus(status, data);
  };

  const setLoading = (loading: boolean, message?: string) => {
    walletStatusStore.actions.setLoading(loading, message);
  };

  const setError = (errorMessage: string | null) => {
    walletStatusStore.actions.setError(errorMessage);
  };

  const clearAll = () => {
    walletStatusStore.actions.clearAll();
  };

  const forceState = (state: WalletStatusState) => {
    walletStatusStore.actions.forceState(state);
  };

  // Handle auth completion from KaiserexAuthPage
  const handleAuthComplete = async () => {
    console.log('🔐 Kaiserex authentication completed');
    setKaiserexAuthentication(true);
    
    // If in development mode, you might want to set mock state
    if (import.meta.env.DEV) {
      // Optional: Set development state or let the computed state handle it
    }
  };

  // Handle KYC completion
  const handleKYCComplete = (status: KYCStatus = 'pending') => {
    console.log('📋 KYC process completed with status:', status);
    setKYCStatus(status, {
      submittedAt: new Date().toISOString()
    });
  };

  // Watch for changes in card store and update wallet status accordingly
  watch(
    [() => cardStore.state.userInfo, () => cardStore.state.cardData, () => cardStore.isAuthenticated],
    () => {
      // Re-evaluate state when card data changes
      // The computed state will automatically update
    },
    { deep: true }
  );

  // Auto-initialize on mount
  onMounted(async () => {
    await initialize();
  });

  // Development helpers
  const devHelpers = import.meta.env.DEV ? {
    // Development-only methods for testing different states
    setDevState: (state: WalletStatusState) => {
      console.warn(`[DEV] Setting wallet state to: ${state}`);
      forceState(state);
    },
    
    simulateKYCApproval: () => {
      console.warn('[DEV] Simulating KYC approval');
      setKYCStatus('approved', {
        approvedAt: new Date().toISOString()
      });
    },
    
    simulateKYCRejection: (reason: string = 'Document verification failed') => {
      console.warn('[DEV] Simulating KYC rejection');
      setKYCStatus('rejected', {
        rejectedAt: new Date().toISOString(),
        rejectionReason: reason
      });
    },

    clearDevData: () => {
      console.warn('[DEV] Clearing all development data');
      clearAll();
      localStorage.removeItem('kaiserexRegistered');
      localStorage.removeItem('kycStatus');
      localStorage.removeItem('kycData');
    }
  } : {};

  return {
    // State
    currentState,
    isLoading,
    error,
    kycStatus,
    isKaiserexAuthenticated,
    
    // Card store integration
    isCardAuthenticated,
    hasUserInfo,
    hasCardData,
    cardLoading,
    
    // Combined status
    canProceedToNext,
    nextAction,
    
    // State checks
    showAuthPage,
    showNewUserFlow,
    showPendingKYC,
    showApprovedHome,
    showLoading,
    
    // Actions
    initialize,
    setKaiserexAuthentication,
    setKYCStatus,
    setLoading,
    setError,
    clearAll,
    handleAuthComplete,
    handleKYCComplete,
    
    // Development helpers (only in dev mode)
    ...devHelpers
  };
}
