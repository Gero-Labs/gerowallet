import { Messaging } from './messaging';
import { bringInitContentScript } from '@bringweb3/chrome-extension-kit';
import { METHOD } from '@/chrome/config';

/**
 * Escape HTML entities to prevent XSS attacks
 * @param text - Untrusted text to escape
 * @returns Safe HTML-escaped string
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

interface BackgroundReply {
  data?: unknown;
  error?: unknown;
}

// Bring runs inside our own content script, so its RPCs must NOT go through the
// webpage proxy controller (which would gate every call behind the dApp
// whitelist and return code -3 Refused for any non-connected site). Talk to the
// background directly instead.
const getWalletAddress = async (): Promise<string> => {
  try {
    const response = (await Messaging.sendToBackground({
      method: METHOD.getAddressBech32,
      data: {},
    })) as BackgroundReply | undefined;
    if (response?.error) return '';
    const address = response?.data;
    if (typeof address === 'string' && address.length > 0) {
      return address;
    }
  } catch (e) {
    console.warn('Failed to get wallet address:', e);
  }
  return '';
};

const promptLogin = async (): Promise<void> => {
  try {
    const response = (await Messaging.sendToBackground({
      method: METHOD.popupLogin,
      data: { userGesture: navigator.userActivation?.isActive },
    })) as BackgroundReply | undefined;
    if (response?.error) {
      console.warn('[content.ts] promptLogin refused by background:', response.error);
      return;
    }
    if (response?.data) {
      window.dispatchEvent(new CustomEvent('gero:login', {
        bubbles: true,
        cancelable: true,
        composed: false,
      }));
    }
  } catch (e) {
    console.warn('[content.ts] promptLogin failed:', e);
  }
};

const injectScript = () => {
  const script = document.createElement('script');
  script.async = false;
  if (chrome?.runtime) {
    script.src = chrome.runtime.getURL('content/inject.js');
  }
  script.onload = () => {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
};

function shouldInject() {
  const documentElement = document.documentElement.nodeName;
  const docElemCheck = documentElement
    ? documentElement.toLowerCase() === 'html'
    : true;
  const docType = window.document.doctype;
  const docTypeCheck = docType ? docType.name === 'html' : true;
  return docElemCheck && docTypeCheck;
}

async function injectBring() {
  await bringInitContentScript({
    'switchWallet': false,
    'text': 'lower',
    getWalletAddress,
    promptLogin,
    'walletAddressListeners': ['gero:login', 'gero:logout'],
    'theme': 'dark',
  });
}

// Store listener reference for cleanup
type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => void;
let messageListener: RuntimeMessageListener | null = null;
let windowLoadListener: (() => void) | null = null;

if (shouldInject()) {
  injectScript();
  (async () => {
    await injectBring();
    Messaging.createProxyController();

    // If the user is already logged in when this page loads, Bring's backend
    // may have cached a stale token (e.g., walletAddress=null from a prior
    // session). Fire `gero:login` once so the Bring SDK pushes the current
    // address to its background and re-fetches a fresh cashback token for
    // this tab. Safe no-op if logged out: getWalletAddress returns ''.
    try {
      const currentAddress = await getWalletAddress();
      if (currentAddress) {
        window.dispatchEvent(new CustomEvent('gero:login', {
          bubbles: true,
          cancelable: true,
          composed: false,
        }));
      }
    } catch (e) {
      console.warn('[content.ts] initial wallet-address check failed:', e);
    }

    // Listen for WalletConnect deep link pairing from inject script
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const msg = e.data;
      if (msg?.target === 'gerowallet' && msg?.method === 'walletconnect_pair' && msg?.data?.uri) {
        // Forward to background as an options-context message so it reaches WC_PAIR handler
        chrome.runtime.sendMessage({
          method: 'WC_PAIR',
          sender: 'options',
          data: { uri: msg.data.uri },
        }).catch(() => {});
      }
    });

    // Store listener reference for cleanup
    messageListener = (message, _sender, _sendResponse) => {
      if (typeof message !== 'object' || message === null) return;
      const msg = message as { action?: string; url?: string; loggedIn?: boolean };
      if (msg.action === 'showOverlay' && typeof msg.url === 'string') {
        showOverlay(msg.url); // Show overlay on the specific tab with this URL
      } else if (msg.action === 'removeOverlay') {
        const overlay = document.getElementById('custom-overlay');
        if (overlay) {
          document.body.removeChild(overlay);
        }
      } else if (msg.action === 'geroLoggedWalletChanged') {
        // Broadcast from the background: the active Gero wallet changed.
        // Dispatch the Bring-configured event so its SDK refreshes the
        // cached wallet address (stored by the SDK in chrome.storage) and
        // re-fetches any pending cashback token for this tab.
        const event = msg.loggedIn ? 'gero:login' : 'gero:logout';
        window.dispatchEvent(new CustomEvent(event, {
          bubbles: true,
          cancelable: true,
          composed: false,
        }));
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
  })();
}

function showOverlay(url: string) {
  if (document.body) {
    appendOverlay(url);
  } else {
    windowLoadListener = () => {
      appendOverlay(url);
      if (windowLoadListener) {
        window.removeEventListener('load', windowLoadListener);
        windowLoadListener = null;
      }
    };
    window.addEventListener('load', windowLoadListener);
  }
}

// Cleanup on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
  if (messageListener) {
    chrome.runtime.onMessage.removeListener(messageListener);
    messageListener = null;
  }

  if (windowLoadListener) {
    window.removeEventListener('load', windowLoadListener);
    windowLoadListener = null;
  }
});

// Also cleanup on page hide (for back/forward cache)
window.addEventListener('pagehide', () => {
  if (messageListener) {
    chrome.runtime.onMessage.removeListener(messageListener);
    messageListener = null;
  }

  if (windowLoadListener) {
    window.removeEventListener('load', windowLoadListener);
    windowLoadListener = null;
  }
});

function appendOverlay(url: string) {
  if (!document.getElementById('custom-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'custom-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(62, 28, 28, 0.96)';
    overlay.style.color = 'white';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'space-around';
    overlay.style.zIndex = '10000000000';
    overlay.style.fontFamily = 'system-ui, sans-serif';

    const imageUrl = chrome.runtime.getURL('public/logo.png');
    overlay.innerHTML = `
    <div>
      <div style="font-size: 1.5rem;padding:2rem;font-weight: 500;display: flex;align-items: center; justify-content: space-between;">
        <p>Potentially deceptive site detected</p>
        <img src="${imageUrl}" alt="Gero Logo" style="height:50px;display:block;z-index:2" />
      </div>
      <div style="padding:.5rem 2rem; font-size: 1rem; max-width: 42.5rem; display:block">
        Cardano Shield has marked the website you're attempting to access as potentially misleading.
        There's a risk that attackers could deceive you into engaging in fraudulent actions.
      </div>
      <div style="padding:.5rem 2rem; font-size: 1rem; max-width: 42.5rem;">
        <div class="list-header">
          Potential threats on <span style="font-weight: 300; color: #ffffff;">${escapeHtml(url)}</span>
        </div>
        <ul style="padding-left:  1.313rem;">
          <li>Fraudulent transactions leading to asset loss</li>
          <li>Theft of secret recovery phrases or passwords</li>
          <li>Imitations of Cardano Wallets</li>
        </ul>
      </div>
      <div style="padding:2rem; font-size: 1rem;">
        <div>
          If we're flagging a legitimate website, please report a detection problem.
        </div>
        <div style="color: #e80404;line-height: 2;">
          Should you be aware of the dangers yet wish to visit the site, you have the option to proceed.
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
  }
}
