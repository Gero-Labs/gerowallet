import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { ref } from 'vue';
import { Backend } from './Backend';

const GOOGLE_URL_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
const ZKFOLD_BACKEND_URL = 'https://api.wallet.zkfold.io';
const ZKFOLD_API_KEY = '123456';

export class ZkFold {
  public accessToken = ref('');
  public idToken = ref('');
  public profile = ref({});
  public zkFoldBackend = null;

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

  public async backend() {
    this.zkFoldBackend = new Backend(ZKFOLD_BACKEND_URL, ZKFOLD_API_KEY);
    return this.zkFoldBackend;
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

  public async login(wallet) {
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });
  }
}

export default ZkFold;