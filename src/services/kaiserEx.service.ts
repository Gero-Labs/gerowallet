/**
 * KaiserEx OAuth Service
 * Handles PKCE authentication flow for KaiserEx token reception
 */
const backendUrl = import.meta.env['VITE_BACKEND_URL'];

export interface KaiserExTokenData {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface KaiserExService {
  baseUrl: string;
  options: {
    width: number;
    height: number;
    asWindow: boolean;
  };
  codeVerifier?: string;
  completeCallback?: (tokenData: KaiserExTokenData) => void;
  KaiserExWindow?: Window | null;
  loginUrl(codeChallenge: string): string;
  base64urlEncode(str: ArrayBuffer): string;
  generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }>;
  auth(completeCallback?: (tokenData: KaiserExTokenData) => void): Promise<void>;
  oauthCodeMessageListener(message: MessageEvent): Promise<void>;
  issueToken(code: string): void;
}

class KaiserExServiceImpl implements KaiserExService {
  baseUrl = `${backendUrl}/api/kaiserex`;
  // The actual OAuth domain that sends the message
  oauthDomain = 'https://api.dev.kaiserex.cybro.cz';

  options = {
    width: 800,
    height: 600,
    asWindow: true,
  };

  codeVerifier?: string;
  completeCallback?: (tokenData: KaiserExTokenData) => void;
  KaiserExWindow?: Window | null;

  loginUrl(codeChallenge: string): string {
    const params = new URLSearchParams({
      redirect: window.location.href,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    // Use backend proxy which now returns proper 302 redirect
    return this.baseUrl + '/login?' + params.toString();
  }

  base64urlEncode(str: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(str)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
    const codeVerifier = [...crypto.getRandomValues(new Uint8Array(64))]
      .map(x => ('0' + x.toString(16)).slice(-2)).join('');

    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const codeChallenge = this.base64urlEncode(hash);

    return { codeVerifier, codeChallenge };
  }

  async auth(completeCallback?: (tokenData: KaiserExTokenData) => void): Promise<void> {
    if (completeCallback) this.completeCallback = completeCallback;

    console.log('[KaiserEx] Starting OAuth flow...');
    const { codeVerifier, codeChallenge } = await this.generatePKCE();
    this.codeVerifier = codeVerifier;
    console.log('[KaiserEx] Generated PKCE - codeChallenge:', codeChallenge);

    const url = this.loginUrl(codeChallenge);
    console.log('[KaiserEx] Opening OAuth URL:', url);
    console.log('[KaiserEx] Expected message origin:', this.oauthDomain);

    if (this.options.asWindow) {
      this.KaiserExWindow = window.open(
        url,
        "oauthWindow",
        `width=${this.options.width},height=${this.options.height}`
      );
    } else {
      this.KaiserExWindow = window.open(url, "oauthWindow");
    }

    console.log('[KaiserEx] Popup window opened, waiting for OAuth callback message...');

    // Bind the message listener to this instance
    const boundListener = this.oauthCodeMessageListener.bind(this);
    window.addEventListener("message", boundListener);
    console.log('[KaiserEx] Message listener registered');

    // Store the bound listener for cleanup
    (this as any)._boundListener = boundListener;
  }

  async oauthCodeMessageListener(message: MessageEvent): Promise<void> {
    console.log('[KaiserEx] Received postMessage from origin:', message.origin);
    console.log('[KaiserEx] Message data:', message.data);
    
    // Accept messages from either the KaiserEx OAuth domain or backend (for local development)
    const allowedOrigins = [
      this.oauthDomain,
      'http://localhost:8081', // Local backend
      'http://localhost:8080', // Alternative local backend port
      window.location.origin // Allow same origin for development
    ];
    
    console.log('[KaiserEx] Allowed origins:', allowedOrigins);
    
    if (!allowedOrigins.includes(message.origin)) {
      console.warn('[KaiserEx] ❌ Rejected message from unauthorized origin:', message.origin);
      console.warn('[KaiserEx] Expected one of:', allowedOrigins);
      return;
    }
    
    console.log('[KaiserEx] ✅ Origin validated');
    
    if (message.data.type === "OAUTH_CODE") {
      console.log('[KaiserEx] OAuth code received:', message.data.code);
      const code = message.data.code;
      if (this.KaiserExWindow) {
        this.KaiserExWindow.close();
        console.log('[KaiserEx] Popup window closed');
      }
      // Remove the event listener
      window.removeEventListener("message", (this as any)._boundListener);
      console.log('[KaiserEx] Starting token exchange...');
      this.issueToken(code);
    } else {
      console.log('[KaiserEx] Message type is not OAUTH_CODE, ignoring');
    }
  }

  issueToken(code: string): void {
    const data = {
      code,
      codeVerifier: this.codeVerifier,
    };
    // Use backend proxy for token exchange
    fetch(this.baseUrl + '/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
      .then(response => response.json())
      .then(async (data: KaiserExTokenData) => {
        if (this.completeCallback) {
          this.completeCallback(data);
        }
      })
      .catch(error => {
        console.error('KaiserEx token exchange error:', error);
        throw error;
      });
  }
}

// Singleton instance
let kaiserExServiceInstance: KaiserExService | null = null;

/**
 * Get the KaiserEx service instance (singleton)
 */
export function getKaiserExService(): KaiserExService {
  if (!kaiserExServiceInstance) {
    kaiserExServiceInstance = new KaiserExServiceImpl();
  }
  return kaiserExServiceInstance;
}

/**
 * Initialize KaiserEx token reception flow
 * @param completeCallback - Callback function to handle successful token reception
 * @returns Promise that resolves when auth flow is initiated
 */
export async function receiveKaiserExToken(
  completeCallback: (tokenData: KaiserExTokenData) => void
): Promise<void> {
  const service = getKaiserExService();
  await service.auth(completeCallback);
}
