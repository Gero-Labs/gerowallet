/**
 * KaiserEx OAuth Service
 * Handles PKCE authentication flow for KaiserEx token reception
 */
const viteBackendUrl = import.meta.env['VITE_BACKEND_URL'];
const backendUrl = 'https://oauth.kaiserex.com';

export interface KaiserExTokenData {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
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
  baseUrl = `${backendUrl}`;

  options = {
    width: 800,
    height: 600,
    asWindow: true,
  };

  codeVerifier?: string;
  completeCallback?: (tokenData: KaiserExTokenData) => void;
  KaiserExWindow?: Window | null;
  checkClosedTimeouts = new Set<NodeJS.Timeout>();

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
    return new Promise((resolve, reject) => {
      // Clean up any previous auth attempt before starting a new one
      this.cleanup();

      if (completeCallback) this.completeCallback = completeCallback;

      this.generatePKCE().then(({ codeVerifier, codeChallenge }) => {
        this.codeVerifier = codeVerifier;

        const url = this.loginUrl(codeChallenge);

        if (this.options.asWindow) {
          this.KaiserExWindow = window.open(
            url,
            "oauthWindow",
            `width=${this.options.width},height=${this.options.height}`
          );
        } else {
          this.KaiserExWindow = window.open(url, "oauthWindow");
        }


        // Bind the message listener to this instance
        const boundListener = this.oauthCodeMessageListener.bind(this);
        window.addEventListener("message", boundListener);

        // Store the bound listener for cleanup
        (this as any)._boundListener = boundListener;
        (this as any)._authResolve = resolve;
        (this as any)._authReject = reject;

        // Monitor popup window closure to reject the promise (but only if auth hasn't completed)
        if (this.KaiserExWindow) {
          let authCompleted = false;
          (this as any)._markAuthCompleted = () => { authCompleted = true; };

          const checkClosed = () => {
            if (this.KaiserExWindow?.closed) {
              if (!authCompleted) {
                // Clean up the message listener
                window.removeEventListener("message", boundListener);
                // Clear any remaining timeouts
                this.checkClosedTimeouts.forEach(id => clearTimeout(id));
                this.checkClosedTimeouts.clear();
                // Reject the auth promise to trigger the error handler in Dashboard
                reject(new Error('Authentication window was closed by user'));
              } else {
                // Clear timeouts on successful completion
                this.checkClosedTimeouts.forEach(id => clearTimeout(id));
                this.checkClosedTimeouts.clear();
              }
            } else {
              const timeoutId = setTimeout(() => {
                this.checkClosedTimeouts.delete(timeoutId);
                checkClosed();
              }, 1000);
              this.checkClosedTimeouts.add(timeoutId);
            }
          };
          const initialTimeoutId = setTimeout(() => {
            this.checkClosedTimeouts.delete(initialTimeoutId);
            checkClosed();
          }, 1000);
          this.checkClosedTimeouts.add(initialTimeoutId);
        }
      });
    });
  }

  async oauthCodeMessageListener(message: MessageEvent): Promise<void> {

    // Accept messages from either the KaiserEx OAuth domain or backend (for local development)
    const allowedOrigins = [
      this.baseUrl,
      'http://localhost:8081', // Local backend
      window.location.origin // Allow the same origin for development
    ];


    if (!allowedOrigins.includes(message.origin)) {
      console.warn('[KaiserEx] ❌ Rejected message from unauthorized origin:', message.origin);
      console.warn('[KaiserEx] Expected one of:', allowedOrigins);
      return;
    }


    if (message.data.type === "OAUTH_CODE") {
      const code = message.data.code;

      // Mark auth as completed to prevent race condition with window close detection
      if ((this as any)._markAuthCompleted) {
        (this as any)._markAuthCompleted();
      }

      if (this.KaiserExWindow) {
        this.KaiserExWindow.close();
      }
      // Remove the event listener
      window.removeEventListener("message", (this as any)._boundListener);
      this.issueToken(code);
    } else {
    }
  }

  issueToken(code: string): void {
    const data = {
      code,
      codeVerifier: this.codeVerifier,
    };
    // Use backend proxy for token exchange
    fetch( `${viteBackendUrl}/api/kaiserex/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
      .then(response => response.json())
      .then(async (data: KaiserExTokenData) => {
        // Mark authentication as completed
        if ((this as any)._markAuthCompleted) {
          (this as any)._markAuthCompleted();
        }
        
        // Clean up all resources
        this.cleanup();
        
        if (this.completeCallback) {
          this.completeCallback(data);
        }
        // Resolve the auth promise
        if ((this as any)._authResolve) {
          (this as any)._authResolve();
          delete (this as any)._authResolve;
          delete (this as any)._authReject;
        }
      })
      .catch(error => {
        console.error('KaiserEx token exchange error:', error);
        
        // Clean up all resources
        this.cleanup();
        
        // Reject the auth promise
        if ((this as any)._authReject) {
          (this as any)._authReject(error);
          delete (this as any)._authResolve;
          delete (this as any)._authReject;
        }
      });
  }

  /**
   * Clean up all resources to prevent memory leaks
   */
  private cleanup(): void {
    // Clear all timeouts
    this.checkClosedTimeouts.forEach(id => clearTimeout(id));
    this.checkClosedTimeouts.clear();

    // Clean up the message listener
    if ((this as any)._boundListener) {
      window.removeEventListener("message", (this as any)._boundListener);
      delete (this as any)._boundListener;
    }

    // Close the popup window
    if (this.KaiserExWindow) {
      this.KaiserExWindow.close();
      this.KaiserExWindow = null;
    }

    // Clear completion callback
    delete (this as any)._markAuthCompleted;
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
