/**
 * KaiserEx OAuth Service
 * Handles PKCE authentication flow for KaiserEx token reception
 */
import { CARD_PROVIDER } from '@/modules/wallet/cardProvider';
import { debugLog } from '@/utils/debug';

const viteBackendUrl = import.meta.env['VITE_BACKEND_URL'];
const backendUrl = import.meta.env['VITE_KAISEREX_OAUTH_URL'] || CARD_PROVIDER.defaultOAuthUrl;

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

/**
 * Origins allowed to deliver the authorization code. The local gero-backend is
 * trusted in dev builds only; import.meta.env.DEV is baked in at build time,
 * which is exactly what keeps it out of release builds.
 */
export function trustedOAuthOrigins(oauthBaseUrl: string, dev: boolean): string[] {
  const origins = [new URL(oauthBaseUrl).origin];
  if (dev) origins.push('http://localhost:8081');
  return origins;
}

/** An OAUTH_CODE message from the sign-in popup we opened, on a trusted origin. */
export function isOAuthCodeMessage(
  message: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  trustedOrigins: string[],
  popup: Window | null | undefined,
): message is MessageEvent<{ type: 'OAUTH_CODE'; code: string }> {
  return trustedOrigins.includes(message.origin)
    && !!popup && message.source === popup
    && message.data?.type === 'OAUTH_CODE'
    && typeof message.data.code === 'string' && message.data.code.length > 0;
}

/** Parses the /api/token reply, refusing anything that is not a token. */
export async function readTokenResponse(
  response: Pick<Response, 'ok' | 'status' | 'json'>,
): Promise<KaiserExTokenData> {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error(`Card sign-in failed (HTTP ${response.status})`);
  }
  return body as KaiserExTokenData;
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
  // State of the in-flight sign-in, cleared by cleanup()
  private boundListener?: (message: MessageEvent) => void;
  private authResolve?: (value: void) => void;
  private authReject?: (error: unknown) => void;
  private markAuthCompleted?: () => void;

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
        this.boundListener = boundListener;
        this.authResolve = resolve;
        this.authReject = reject;

        // Monitor popup window closure to reject the promise (but only if auth hasn't completed)
        if (this.KaiserExWindow) {
          let authCompleted = false;
          this.markAuthCompleted = () => { authCompleted = true; };

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
    const trustedOrigins = trustedOAuthOrigins(this.baseUrl, import.meta.env.DEV);
    if (!isOAuthCodeMessage(message, trustedOrigins, this.KaiserExWindow)) {
      if (message.data?.type === 'OAUTH_CODE') {
        debugLog('[KaiserEx] Ignored OAUTH_CODE from untrusted sender', message.origin);
      }
      return;
    }

    // Mark auth as completed to prevent race condition with window close detection
    if (this.markAuthCompleted) {
      this.markAuthCompleted();
    }

    if (this.KaiserExWindow) {
      this.KaiserExWindow.close();
    }
    // Remove the event listener
    if (this.boundListener) {
      window.removeEventListener("message", this.boundListener);
    }
    this.issueToken(message.data.code);
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
      .then(readTokenResponse)
      .then(async (data: KaiserExTokenData) => {
        // Mark authentication as completed
        if (this.markAuthCompleted) {
          this.markAuthCompleted();
        }
        
        // Clean up all resources
        this.cleanup();
        
        if (this.completeCallback) {
          this.completeCallback(data);
        }
        // Resolve the auth promise
        if (this.authResolve) {
          this.authResolve();
          this.authResolve = undefined;
          this.authReject = undefined;
        }
      })
      .catch(error => {
        console.error('KaiserEx token exchange error:', error);
        
        // Clean up all resources
        this.cleanup();
        
        // Reject the auth promise
        if (this.authReject) {
          this.authReject(error);
          this.authResolve = undefined;
          this.authReject = undefined;
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
    if (this.boundListener) {
      window.removeEventListener("message", this.boundListener);
      this.boundListener = undefined;
    }

    // Close the popup window
    if (this.KaiserExWindow) {
      this.KaiserExWindow.close();
      this.KaiserExWindow = null;
    }

    // Clear completion callback
    this.markAuthCompleted = undefined;
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
