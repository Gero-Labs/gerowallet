import { computed, onMounted } from 'vue'
import cardStore from '@/stores/modules/card'

/**
 * SIMPLE composable for wallet status management
 * Uses only ONE card store - no complexity!
 */
export function useWalletStatus() {
  // ============================================================================
  // COMPUTED PROPERTIES - ALL FROM ONE STORE!
  // ============================================================================
  
  // Core state
  const currentState = computed(() => cardStore.currentState)
  const isLoading = computed(() => cardStore.state.loading?.initialize || false)
  const error = computed(() => cardStore.state.walletStatus?.error || null)
  const loadingMessage = computed(() => cardStore.state.walletStatus?.loadingMessage || '')
  
  // Authentication state
  const isKaiserexAuthenticated = computed(() => cardStore.state.walletStatus?.isKaiserexAuthenticated || false)
  
  // KYC state
  const kycStatus = computed(() => cardStore.state.walletStatus?.kycStatus || 'not_started')
  const kycData = computed(() => cardStore.state.walletStatus?.kycData || null)
  
  // Card data
  const isCardAuthenticated = computed(() => cardStore.isAuthenticated)
  const hasUserInfo = computed(() => !!cardStore.state.userInfo)
  const hasCardData = computed(() => !!cardStore.state.cardData)
  
  // State-specific computed properties for component visibility
  const showAuthPage = computed(() => currentState.value === 'auth')
  const showNewUserFlow = computed(() => currentState.value === 'new')
  const showPendingKYC = computed(() => currentState.value === 'pending')
  const showApprovedHome = computed(() => currentState.value === 'approved')
  const showLoadingState = computed(() => currentState.value === 'loading' || isLoading.value)
  const showErrorState = computed(() => currentState.value === 'error' || !!error.value)
  
  /**
   * Initialize card store
   */
  async function initialize(wallet?: any): Promise<void> {
    await cardStore.initialize(wallet)
  }

  /**
   * Set Kaiserex authentication status
   */
  function setKaiserexAuthentication(isAuthenticated: boolean): void {
    cardStore.setKaiserexAuthentication(isAuthenticated)
  }

  /**
   * Set KYC status with optional data
   */
  function setKYCStatus(status: string, data?: any): void {
    cardStore.setKYCStatus(status, data)
  }

  /**
   * Set error state
   */
  function setError(errorMessage: string): void {
    cardStore.setError(errorMessage)
  }

  /**
   * Clear error state
   */
  function clearError(): void {
    cardStore.clearError()
  }

  /**
   * Clear all data (logout)
   */
  async function clearAll(): Promise<void> {
    await cardStore.logout()
  }

  /**
   * Handle authentication completion from KaiserexAuthPage
   */
  async function handleAuthComplete(): Promise<void> {
    console.log('🔐 Kaiserex authentication completed')
    setKaiserexAuthentication(true)
    clearError()
  }

  /**
   * Handle KYC completion
   */
  async function handleKYCComplete(status: string = 'pending', data?: any): Promise<void> {
    console.log('📋 KYC process completed with status:', status)
    setKYCStatus(status, data)
  }

  // ============================================================================
  // DEVELOPMENT HELPERS - SIMPLE!
  // ============================================================================
  
  const devHelpers = process.env['NODE_ENV'] === 'development' ? {
    /**
     * Test authentication state
     */
    testAuthState(): void {
      setKaiserexAuthentication(false)
    },

    /**
     * Test new user state
     */
    testNewState(): void {
      setKaiserexAuthentication(true)
      setKYCStatus('not_started')
    },

    /**
     * Test pending KYC state
     */
    testPendingState(): void {
      setKaiserexAuthentication(true)
      setKYCStatus('pending')
    },

    /**
     * Test approved state
     */
    testApprovedState(): void {
      setKaiserexAuthentication(true)
      setKYCStatus('approved')
    },

    /**
     * Simulate KYC approval
     */
    simulateKYCApproval(): void {
      setKYCStatus('approved')
    },

    /**
     * Clear development data
     */
    clearDevData(): void {
      clearError()
    },
  } : {}

  // ============================================================================
  // LIFECYCLE
  // ============================================================================
  
  // Auto-initialize on mount
  onMounted(async () => {
    await initialize()
  })

  // ============================================================================
  // RETURN COMPOSABLE API - SIMPLE!
  // ============================================================================
  
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
  }
}