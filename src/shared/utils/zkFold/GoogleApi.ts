/**
 * GoogleApi class for OAuth 2.0 authorization code flow authentication for Gmail-based wallets
 * Based on zkFold smart-wallet-api implementation
 */
export class GoogleApi {
    private clientId: string;
    private clientSecret: string;
    private redirectURL: string;

    constructor(clientId: string, clientSecret: string, redirectURL: string) {
        /**
         * To use OAuth2 authentication, we need access to a CLIENT_ID, CLIENT_SECRET, AND REDIRECT_URI
         * from the client_secret.json file. To get these credentials for your application, visit
         * https://console.cloud.google.com/apis/credentials.
         */
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectURL = redirectURL;
    }

    /**
     * Generate Google OAuth authorization URL
     * @param state - Random state parameter for CSRF protection
     * @returns Authorization URL
     */
    getAuthUrl(state: string): string {
        // Example access scopes for Web2 login: user email is used.
        const scopes = [
            'https://www.googleapis.com/auth/userinfo.email',
            'openid',
        ];

        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectURL,
            response_type: 'code',
            scope: scopes.join(' '),
            access_type: 'offline',
            include_granted_scopes: 'true',
            state: state
        });

        const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
        return authorizationUrl;
    }

    /**
     * Exchange authorization code for JWT token
     * @param code - Authorization code from Google OAuth callback
     * @returns JWT ID token or undefined on error
     */
    async getJWT(code: string): Promise<string | undefined> {
        try {
            const tokenEndpoint = 'https://oauth2.googleapis.com/token';

            const params = new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: this.redirectURL
            });

            const response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params.toString()
            });

            if (!response.ok) {
                throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
            }

            const tokens = await response.json();
            console.info('Tokens acquired.');
            return tokens.id_token;
        } catch (e) {
            console.log(e);
        }
    }
}
