import { computed } from 'vue';
import cardStoreModule from '@/stores/modules/card';

/**
 * SIMPLE composable for wallet status management
 * Uses only ONE card store - no complexity!
 */
export function useWalletStatus() {
  // ============================================================================
  // COMPUTED PROPERTIES - ALL FROM ONE STORE!
  // ============================================================================

  // Core state
  const currentState = computed(() => cardStoreModule.currentState);
  const isLoading = computed(() => cardStoreModule.state.loading?.initialize || false);
  const error = computed(() => cardStoreModule.state.walletStatus?.error || null);
  const loadingMessage = computed(() => cardStoreModule.state.walletStatus?.loadingMessage || '');

  // Authentication state
  const isKaiserexAuthenticated = computed(() => cardStoreModule.state.walletStatus?.isKaiserexAuthenticated || false);

  // KYC state
  const kycStatus = computed(() => cardStoreModule.state.walletStatus?.kycStatus || 'unverified');
  const kycData = computed(() => cardStoreModule.state.walletStatus?.kycData || null);

  // Card data
  const isCardAuthenticated = computed(() => cardStoreModule.isAuthenticated);
  const hasUserInfo = computed(() => !!cardStoreModule.state.userInfo);
  const hasCardData = computed(() => !!cardStoreModule.getSelectedCard()?.cardData);

  // State-specific computed properties for component visibility
  const showAuthPage = computed(() => currentState.value === 'auth');
  const showNewUserFlow = computed(() => currentState.value === 'new');
  const showPendingKYC = computed(() => currentState.value === 'pending');
  const showApprovedHome = computed(() => currentState.value === 'approved');
  const showLoadingState = computed(() => currentState.value === 'loading' || isLoading.value);
  const showErrorState = computed(() => currentState.value === 'error' || !!error.value);

  /**
   * Initialize card store
   */
  async function initialize(): Promise<void> {
    await cardStoreModule.initialize();
  }

  /**
   * Set Kaiserex authentication status
   */
  function setKaiserexAuthentication(isAuthenticated: boolean): void {
    cardStoreModule.setKaiserexAuthentication(isAuthenticated);
  }

  /**
   * Set KYC status with optional data
   */
  function setKYCStatus(status: string, data?: any): void {
    // Direct state mutation for testing/development
    cardStoreModule.state.walletStatus.kycStatus = status as any;
    if (data) {
      cardStoreModule.state.walletStatus.kycData = data;
    }
  }

  /**
   * Set error state
   */
  function setError(errorMessage: string): void {
    cardStoreModule.setError(errorMessage);
  }

  /**
   * Clear error state
   */
  function clearError(): void {
    cardStoreModule.clearError();
  }

  /**
   * Clear all data (logout)
   */
  async function clearAll(): Promise<void> {
    await cardStoreModule.logout();
  }

  /**
   * Handle authentication completion from KaiserexAuthPage
   */
  async function handleAuthComplete(): Promise<void> {
    setKaiserexAuthentication(true);
    clearError();
  }

  /**
   * Handle KYC completion
   */
  async function handleKYCComplete(status: string = 'pending', data?: any): Promise<void> {
    setKYCStatus(status, data);
  }

  // ============================================================================
  // DEVELOPMENT HELPERS - SIMPLE!
  // ============================================================================

  const devHelpers =
    process.env['NODE_ENV'] === 'development'
      ? {
          /**
           * Test authentication state
           */
          testAuthState(): void {
            setKaiserexAuthentication(false);
          },

          /**
           * Test new user state
           */
          testNewState(): void {
            setKaiserexAuthentication(true);
            setKYCStatus('unverified');
          },

          /**
           * Test pending KYC state
           */
          testPendingState(): void {
            setKaiserexAuthentication(true);
            setKYCStatus('pending');
          },

          /**
           * Test approved state
           */
          testApprovedState(): void {
            setKaiserexAuthentication(true);
            setKYCStatus('approved');
          },

          /**
           * Simulate KYC approval
           */
          simulateKYCApproval(): void {
            setKYCStatus('approved');
          },

          /**
           * Clear development data
           */
          clearDevData(): void {
            clearError();
          },
        }
      : {};
  return {
    // Core state
    currentState,
    isLoading,
    error,
    loadingMessage,

    // Authentication state
    isKaiserexAuthenticated,

    // KYC state
    kycStatus,
    kycData,

    // Card data
    isCardAuthenticated,
    hasUserInfo,
    hasCardData,

    // Component visibility
    showAuthPage,
    showNewUserFlow,
    showPendingKYC,
    showApprovedHome,
    showLoadingState,
    showErrorState,

    // Actions
    initialize,
    setKaiserexAuthentication,
    setKYCStatus,
    setError,
    clearError,
    clearAll,
    handleAuthComplete,
    handleKYCComplete,

    // Development helpers (only in dev mode)
    ...devHelpers,
  };
}
