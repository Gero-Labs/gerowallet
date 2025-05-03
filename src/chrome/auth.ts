import browser, { Manifest } from 'webextension-polyfill';

type ManifestWithOAuth2 = Manifest.WebExtensionManifest & {
  oauth2?: { client_id: string; scopes: string[] };
};

const manifest: ManifestWithOAuth2 = browser.runtime.getManifest() as ManifestWithOAuth2;

const { client_id, scopes }: { client_id: string; scopes: string[] } = manifest.oauth2!;

export async function signInWithGoogle(): Promise<{accessToken: string; idToken: string}> {
  const redirectUri: string = browser.identity.getRedirectURL();
  const authUrl: URL = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', client_id);
  authUrl.searchParams.set('response_type', 'id_token token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set("nonce", Math.random().toString(36).substr(2));
  try {
    const resultUrl: string = await browser.identity.launchWebAuthFlow({
      interactive: true,
      url: authUrl.toString(),
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
