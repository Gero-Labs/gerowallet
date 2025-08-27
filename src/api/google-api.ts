export class GoogleApi {
    private clientId: string;
    private clientSecret: string;
    private redirectURI: string;
    private scopes: string[];
    private state: string;

    constructor(clientId: string, clientSecret: string, scopes: string[], redirectURI: string) {
        /**
         * To use OAuth2 authentication, we need access to a CLIENT_ID, CLIENT_SECRET, AND REDIRECT_URI
         * from the client_secret.json file. To get these credentials for your application, visit
         * https://console.cloud.google.com/apis/credentials.
         */
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectURI = redirectURI;
        this.scopes = scopes;
        this.state = crypto.randomUUID();
    }

    getAuthUrl(): string {

        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectURI,
            response_type: 'id_token token',
            scope: this.scopes.join(' '),
            prompt: 'select_account',
            include_granted_scopes: 'true',
            nonce: this.state
        });

        const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
        return authorizationUrl;
    };

    async getJWT(code: string): Promise<string | undefined> {
        try {
            const tokenEndpoint = 'https://oauth2.googleapis.com/token';

            const params = new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: this.redirectURI
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