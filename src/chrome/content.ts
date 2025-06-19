import { Messaging } from './messaging';
import { bringInitContentScript } from '@bringweb3/chrome-extension-kit';
import { getAddressBech32, promptLogin } from '@/chrome/webpage';

const getWalletAddress = async (): Promise<string> => {
  try {
    const addresses = await getAddressBech32();
    if (addresses && addresses.length > 0) {
      return addresses[0];
    }
  } catch (e) {
    console.log(e);
  }
  return undefined;
};

const injectScript = () => {
  const script = document.createElement('script');
  script.async = false;
  if (chrome?.runtime) {
    script.src = chrome.runtime.getURL('content/_virtual_inject.js');
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
    },
  });
}

if (shouldInject()) {
  injectScript();
  await injectBring();
  Messaging.createProxyController();
}

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.action === 'showOverlay') {
    showOverlay(message.url); // Show overlay on the specific tab with this URL
  } else if (message.action === 'removeOverlay') {
    const overlay: HTMLElement = document.getElementById('custom-overlay');
    if (overlay) {
      document.body.removeChild(overlay);
    }
  }
});

function showOverlay(url: string) {
  if (document.body) {
    appendOverlay(url);
  } else {
    const onLoad = () => {
      appendOverlay(url);
      window.removeEventListener('load', onLoad);
    };
    window.addEventListener('load', onLoad);
  }
}

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
          Potential threats on <span style="font-weight: 300; color: #ffffff;">${url}</span>
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
