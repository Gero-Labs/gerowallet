import browser, { Manifest } from 'webextension-polyfill';

type ManifestWithOAuth2 = Manifest.WebExtensionManifest & {
  oauth2?: { client_id: string; scopes: string[] };
};

const manifest: ManifestWithOAuth2 = browser.runtime.getManifest() as ManifestWithOAuth2;

const { client_id, scopes }: { client_id: string; scopes: string[] } = manifest.oauth2!;

// CSPRNG token for OAuth state/nonce. Math.random() is predictable and must not
// gate MPC key-material release; use crypto.getRandomValues.
function cryptoRandomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(part)) as Record<string, unknown>;
}

export async function signInWithGoogle(): Promise<{accessToken: string; idToken: string}> {
  const redirectUri: string = browser.identity.getRedirectURL();
  const authUrl: URL = new URL('https://accounts.google.com/o/oauth2/v2/auth');

  // CSRF state + replay nonce, both CSPRNG-generated.
  const state = cryptoRandomToken();
  const nonce = cryptoRandomToken();

  authUrl.searchParams.set('client_id', client_id);
  authUrl.searchParams.set('response_type', 'id_token token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('state', state);

  try {
    const resultUrl: string = await browser.identity.launchWebAuthFlow({
      interactive: true,
      url: authUrl.toString(),
    });

    const hash: string = new URL(resultUrl).hash.substring(1);
    const params: URLSearchParams = new URLSearchParams(hash);

    // Validate state parameter
    const returnedState = params.get('state');
    if (returnedState !== state) {
      throw new Error('State mismatch. Possible CSRF attack');
    }

    const accessToken: string = params.get('access_token');
    const idToken: string = params.get('id_token');
    if (!accessToken) {
      throw new Error('Google OAuth2: No access token returned');
    }
    // Validate the id_token nonce claim binds to our request (replay protection).
    if (idToken) {
      let tokenNonce: unknown;
      try {
        tokenNonce = decodeJwtPayload(idToken)['nonce'];
      } catch {
        throw new Error('Google OAuth2: unparseable id_token');
      }
      if (tokenNonce !== nonce) {
        throw new Error('Nonce mismatch. Possible replay attack');
      }
    }
    return { accessToken, idToken };
  } catch (error) {
    throw new Error(`Google OAuth2: ${error['message']}`);
  }

}
