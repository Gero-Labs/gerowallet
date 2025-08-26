import browser, { Manifest } from 'webextension-polyfill';
import { GoogleApi } from '@/api/google-api'

type ManifestWithOAuth2 = Manifest.WebExtensionManifest & {
  oauth2?: { client_id: string; client_secret: string; scopes: string[] };
};

const manifest: ManifestWithOAuth2 = browser.runtime.getManifest() as ManifestWithOAuth2;

const { client_id, client_secret, scopes }: { client_id: string; client_secret: string; scopes: string[] } = manifest.oauth2!;

export async function signInWithGoogle(): Promise<{accessToken: string; idToken: string}> {
  const redirectUri: string = browser.identity.getRedirectURL();
  console.log('redirectUri: ----> ', redirectUri);
  const gapi = new GoogleApi(client_id, client_secret, scopes, redirectUri);
  const authUrl: string = gapi.getAuthUrl();

  console.log('authUrl: ----> ', authUrl);

  try {
    const resultUrl: string = await browser.identity.launchWebAuthFlow({
      interactive: true,
      url: authUrl,
    });

    const hash: string = new URL(resultUrl).hash.substring(1);
    const params: URLSearchParams = new URLSearchParams(hash);
    const accessToken: string = params.get('access_token');
    const idToken: string = params.get('id_token');
    if (!accessToken) {
      throw new Error('Google OAuth2: No access token returned');
    }
    return { accessToken, idToken };
  } catch (error) {
    throw new Error(`Google OAuth2: ${error['message']}`);
  }

}
