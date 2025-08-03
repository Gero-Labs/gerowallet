// Example usage of mock data for testing
import cardStore from '@/stores/modules/card';
import { 
  mockAuthTokens, 
  mockUserInfo, 
  mockCardanoAddress, 
  mockCardData, 
  mockCardNumber, 
  mockCardBalance, 
  mockHistoryResponse 
} from './card-mock';

// Example: How to use mock data in development
export const useMockCardData = () => {
  // Mock authentication
  const mockAuthenticate = async () => {
    cardStore.state.accessToken = mockAuthTokens.access_token;
    cardStore.state.refreshToken = mockAuthTokens.refresh_token;
    cardStore.state.tokenExpiry = Date.now() + mockAuthTokens.expires_in * 1000;
  };

  // Mock user info
  const mockFetchUserInfo = async () => {
    cardStore.state.loading.userInfo = true;
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API delay
    cardStore.state.userInfo = mockUserInfo;
    cardStore.state.loading.userInfo = false;
  };

  // Mock cardano address
  const mockFetchCardanoAddress = async () => {
    cardStore.state.loading.cardanoAddress = true;
    await new Promise(resolve => setTimeout(resolve, 800));
    cardStore.state.cardanoAddress = mockCardanoAddress;
    cardStore.state.loading.cardanoAddress = false;
  };

  // Mock card data
  const mockFetchCardData = async () => {
    cardStore.state.loading.cardData = true;
    await new Promise(resolve => setTimeout(resolve, 600));
    console.log('Setting cardData to:', mockCardData);
    cardStore.state.cardData = mockCardData;
    cardStore.state.loading.cardData = false;
  };

  // Mock card number
  const mockFetchCardNumber = async () => {
    cardStore.state.loading.cardNumber = true;
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('Setting cardNumber to:', mockCardNumber);
    cardStore.state.cardNumber = mockCardNumber;
    cardStore.state.loading.cardNumber = false;
  };

  // Mock card balance
  const mockFetchCardBalance = async () => {
    cardStore.state.loading.cardBalance = true;
    await new Promise(resolve => setTimeout(resolve, 400));
    cardStore.state.cardBalance = mockCardBalance;
    cardStore.state.loading.cardBalance = false;
  };

  // Mock card history
  const mockFetchCardHistory = async (params = {}) => {
    cardStore.state.loading.cardHistory = true;
    await new Promise(resolve => setTimeout(resolve, 1200));
    console.log('Setting cardHistory to:', mockHistoryResponse);
    cardStore.state.cardHistory = mockHistoryResponse;
    cardStore.state.loading.cardHistory = false;
  };

  // Initialize all mock data
  const initializeMockData = async () => {
    await mockAuthenticate();
    await Promise.all([
      mockFetchUserInfo(),
      mockFetchCardanoAddress(),
      mockFetchCardData(),
      mockFetchCardBalance(),
      mockFetchCardHistory(),
    ]);
  };

  return {
    mockAuthenticate,
    mockFetchUserInfo,
    mockFetchCardanoAddress,
    mockFetchCardData,
    mockFetchCardNumber,
    mockFetchCardBalance,
    mockFetchCardHistory,
    initializeMockData,
  };
};

// Usage example in component:
/*
<script setup lang="ts">
import { useMockCardData } from '@/models/card-example';

const { initializeMockData } = useMockCardData();

onMounted(async () => {
  // Use mock data in development
  if (import.meta.env.DEV) {
    await initializeMockData();
  }
});
</script>
*/ 