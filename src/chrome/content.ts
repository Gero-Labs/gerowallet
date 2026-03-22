import { Messaging } from './messaging';
import { bringInitContentScript } from '@bringweb3/chrome-extension-kit';
import { getAddressBech32, promptLogin } from '@/chrome/webpage';

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

const getWalletAddress = async (): Promise<string> => {
  try {
    const addresses = await getAddressBech32();
    if (addresses && addresses.length > 0) {
      return addresses[0];
    }
  } catch (e) {
    console.warn('Failed to get wallet address:', e);
  }
  return '';
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
    switchWallet: false,
    text: 'lower',
    getWalletAddress,
    promptLogin,
    walletAddressListeners: ['gero:login', 'gero:logout'],
    theme: 'dark',
    darkTheme: {
      // font
      fontUrl: 'https://fonts.googleapis.com/css2?family=Inter&display=swap',
      fontFamily: '\'Inter\', system-ui',
      // Popup
      popupBg: '#141414',
      popupShadow: '',
      // Primary button
      primaryBtnBg: 'linear-gradient(to right, #00c7f3, #00fad5)',
      primaryBtnFC: '#041417',
      primaryBtnFW: '600',
      primaryBtnFS: '14px',
      primaryBtnBorderC: 'transparent',
      primaryBtnBorderW: '0',
      primaryBtnRadius: '8px',
      // Secondary button
      secondaryBtnBg: 'transparent',
      secondaryBtnFS: '12px',
      secondaryBtnFW: '500',
      secondaryBtnFC: 'white',
      secondaryBtnBorderC: 'rgba(149, 176, 178, 0.50)',
      secondaryBtnBorderW: '2px',
      secondaryBtnRadius: '8px',
      // Markdown
      markdownBg: '#07131766',
      markdownFS: '12px',
      markdownFC: '#DADCE5',
      markdownBorderW: '0',
      markdownRadius: '4px',
      markdownBorderC: 'black',
      markdownScrollbarC: '#DADCE5',
      // Wallet address
      walletBg: '#1a1a1a',
      walletFS: '10px',
      walletFW: '400',
      walletFC: 'white',
      walletBorderC: 'white',
      walletBorderW: '0',
      walletRadius: '4px',
      // Details of offering
      detailsBg: '#1a1a1a',
      detailsTitleFS: '15px',
      detailsTitleFW: '600',
      detailsTitleFC: 'white',
      detailsSubtitleFS: '14px',
      detailsSubtitleFW: '500',
      detailsSubtitleFC: '#A8ADBF',
      detailsRadius: '8px',
      detailsBorderW: '0',
      detailsBorderC: 'transparent',
      detailsAmountFC: '#00DFF3',
      detailsAmountFW: '700',
      // Overlay
      overlayBg: '#192E34E6',
      overlayFS: '13px',
      overlayFW: '400',
      overlayFC: '#DADCE5',
      loaderBg: '#0A2EC0',
      // Optout \ Turn off
      optoutBg: '#192E34',
      optoutFS: '14px',
      optoutFW: '400',
      optoutFC: 'white',
      optoutRadius: '56px',
      // X Button and close buttons
      closeFS: '9px',
      closeFW: '300',
      closeFC: '#B9BBBF',
      // Token name
      tokenBg: 'transparent',
      tokenFS: '13px',
      tokenFW: '600',
      tokenFC: '#DADCE5',
      tokenBorderW: '2px',
      tokenBorderC: '#DADCE5',
      // Notification popup
      notificationFS: '14px',
      notificationFW: '500',
      notificationFC: 'white',
      notificationBtnBg: 'linear-gradient(135deg, #00DFF3 0%, #FDFC47 100%)',
      notificationBtnFS: '12px',
      notificationBtnFW: '500',
      notificationBtnFC: '#041417',
      notificationBtnBorderW: '0',
      notificationBtnBorderC: 'transparent',
      notificationBtnRadius: '8px',
      activateTitleFS: '--activate-title-f-s',
      activateTitleFW: '--activate-title-f-w',
      activateTitleFC: '--activate-title-f-c',
      activateTitleBoldFS: '--activate-title-bold-f-s',
      activateTitleBoldFW: '--activate-title-bold-f-w',
      activateTitleBoldFC: '--activate-title-bold-f-c',
      obBg: "linear-gradient(179deg, #00D6E9 0.68%, #00B0CF 99.85%)",
      obCloseBtnTopHoverBg: "#00ADCC",
      obOfferTextFS: "13px",
      obOfferTextFW: "500",
      obOfferTextFC: "#1A1A1A",
      obOfferTextLH: "13px",
      obOfferAmountFS: "21px",
      obOfferAmountFW: "700",
      obOfferAmountFC: "#1A1A1A",
      obOfferAmountLH: "17px",
      obActivateBtnBg: "#1A1A1A",
      obActivateBtnFS: "13px",
      obActivateBtnFW: "700",
      obActivateBtnFC: "#FFF",
      obActivateBtnLH: "13px",
      obActivateBtnBorderC: "transparent",
      obActivateBtnBorderW: "0",
      obActivateBtnRadius: "4px",
      obOptOutBtnBg: "#1A1A1A",
      obOptOutBtnFS: "13px",
      obOptOutBtnFW: "700",
      obOptOutBtnFC: "#FFFFFF",
      obOptOutBtnLH: "13px",
      obOptOutBtnBorderC: "transparent",
      obOptOutBtnBorderW: "0",
      obOptOutBtnRadius: "4px",
      obCloseBtnFS: "13px",
      obCloseBtnFW: "500",
      obCloseBtnFC: "#1A1A1A",
      obCloseBtnLH: "13px",
      obPlatformLogosBg: "#00ADCC",
      obRetailerLogoBg: "#FFFFFF",
      obPlatformWalletLogoBg: "#1A1A1A",
      obOptOutTitleFS: "14px",
      obOptOutTitleFW: "600",
      obOptOutTitleFC: "#1A1A1A",
      obOptOutTitleLH: "18px",
      obOptOutMainBtnBg: "#1A1A1A",
      obOptOutMainBtnFS: "13px",
      obOptOutMainBtnFW: "700",
      obOptOutMainBtnFC: "#FFF",
      obOptOutMainBtnLH: "13px",
      obOptOutMainBtnBorderW: "0",
      obOptOutMainBtnBorderC: "transparent",
      obOptOutMainBtnRadius: "4px",
      obOptOutSecondaryBtnBg: "transparent",
      obOptOutSecondaryBtnFS: "13px",
      obOptOutSecondaryBtnFW: "700",
      obOptOutSecondaryBtnFC: "#1A1A1A",
      obOptOutSecondaryBtnLH: "13px",
      obOptOutSecondaryBtnBorderW: "1px",
      obOptOutSecondaryBtnBorderC: "#1A1A1A",
      obOptOutSecondaryBtnRadius: "4px",
      obOptOutBackBtnFS: "11px",
      obOptOutBackBtnFW: "500",
      obOptOutBackBtnFC: "#1A1A1A",
      obOptOutBackBtnLH: "25px",
    }
  });
}

// Store listener reference for cleanup
let messageListener: ((message: any, sender: any, sendResponse: any) => void) | null = null;
let windowLoadListener: (() => void) | null = null;

if (shouldInject()) {
  injectScript();
  (async () => {
    await injectBring();
    Messaging.createProxyController();

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
      if (message.action === 'showOverlay') {
        showOverlay(message.url); // Show overlay on the specific tab with this URL
      } else if (message.action === 'removeOverlay') {
        const overlay: HTMLElement = document.getElementById('custom-overlay');
        if (overlay) {
          document.body.removeChild(overlay);
        }
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
