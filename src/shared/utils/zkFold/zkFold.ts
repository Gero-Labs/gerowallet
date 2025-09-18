import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { ref } from 'vue';
import { Backend, Prover, Wallet, GoogleApi } from '@/shared/utils/zkFold';

const GOOGLE_URL_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
const ZKFOLD_BACKEND_URL = 'https://api.wallet.zkfold.io';
const ZKFOLD_PROVER_URL = 'https://prover.zkfold.io';
const ZKFOLD_API_KEY = '123456';

export class ZkFold {
  public accessToken = ref('');
  public idToken = ref('');
  public profile = ref({});
  public zkFoldBackend: Backend | null = null;
  public zkFoldProver: Prover | null = null;
  public googleApi: GoogleApi | null = null;

  public async initConnection(): Promise<void> {
    try {
      const resp = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_WITH_GOOGLE,
        data: {},
      });
      if (!resp || !resp['data'] || !resp['data']['success']) {
        throw new Error(resp['error'] || 'Unknown error');
      }
      this.accessToken.value = resp['data']['tokens']['accessToken'];
      this.idToken.value = resp['data']['tokens']['idToken'];
    } catch (error) {
      console.error(error);
    }
    return;
  }

  public backend(): Backend {
    if (!this.zkFoldBackend) {
      this.zkFoldBackend = new Backend(ZKFOLD_BACKEND_URL, ZKFOLD_API_KEY);
    }
    return this.zkFoldBackend;
  }

  public prover(): Prover {
    if (!this.zkFoldProver) {
      this.zkFoldProver = new Prover(ZKFOLD_PROVER_URL);
    }
    return this.zkFoldProver;
  }

  public async getGoogleApi(): Promise<GoogleApi> {
    if (!this.googleApi) {
      // Get OAuth credentials from backend
      const credentials = await this.backend().credentials();
      this.googleApi = new GoogleApi(
        credentials.client_id,
        credentials.client_secret,
        chrome.identity.getRedirectURL()
      );
    }
    return this.googleApi;
  }

  public async fetchProfile() {
    const profileResp = await fetch(GOOGLE_URL_USERINFO, {
      headers: { Authorization: `Bearer ${this.accessToken.value}` },
    });
    if (!profileResp.ok) {
      throw new Error('Failed to fetch Google profile');
    }
    this.profile.value = await profileResp.json();
    if (!this.profile.value['email_verified']) {
      throw new Error('Google profile email is not verified');
    }

    return this.profile.value;
  }

  public async login(wallet, jwt?: string) {
    if(jwt){
        wallet.jwt = jwt;
    }
    
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });
  }

  /**
   * Create a new Google wallet with ZK proof activation
   * @param walletData - Wallet creation data
   * @returns Wallet creation result
   */
  public async createWallet(walletData: {
    name: string;
    icon: string;
    theme: string;
    password: string;
    chain: string;
    network: string;
  }): Promise<{ walletId: number; address: string }> {
    try {
      // Create zkFold wallet instance
      const zkWallet = new Wallet(this.backend(), this.prover(), { jwt: this.idToken.value });
      
      // Get wallet address
      const walletAddress = await zkWallet.getAddress();
      
      // Create wallet in local database
      const walletId = await this.createLocalWallet(walletData);
      
      return {
        walletId,
        address: walletAddress.to_bech32()
      };
    } catch (error) {
      console.error('Failed to create Google wallet:', error);
      throw error;
    }
  }

  /**
   * Create wallet entry in local database (placeholder)
   * This should be implemented to call the actual database creation
   */
  private async createLocalWallet(walletData: any): Promise<number> {
    // This would typically call the database service
    // For now, return a placeholder
    return Date.now(); // Temporary ID
  }
}

export default ZkFold;