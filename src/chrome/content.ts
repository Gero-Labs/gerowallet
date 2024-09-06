import { Messaging } from './messaging';
import { bringInitContentScript } from '@bringweb3/chrome-extension-kit';
import { getAddressBech32, promptLogin } from '@/chrome/webpage';

const getWalletAddress = async (): Promise<string> => {
  try {
    const addresses = await getAddressBech32()
    if (addresses && addresses.length > 0) {
      return addresses[0]
    }
  } catch (e) {
    console.log(e)
  }
  return undefined;
};


const injectScript = () => {
  const script = document.createElement('script');
  script.async = false;
  if (chrome?.runtime) {
    script.src = chrome.runtime.getURL('js/inject.js');
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
    iframeEndpoint: 'https://extension.bringweb3.io/',
    getWalletAddress,
    promptLogin, //prompt login
    walletAddressListeners: ['gero:login', 'gero:logout'],
    customTheme: {
      // font
      fontUrl: 'https://fonts.googleapis.com/css2?family=Inter&display=swap',
      fontFamily: "'Inter', system-ui",
      // Popup
      popupBg: "#141414",
      popupShadow: "",
      // Primary button
      primaryBtnBg: "linear-gradient(to right, #00c7f3, #00fad5)",
      primaryBtnFC: "#041417",
      primaryBtnFW: "600",
      primaryBtnFS: "14px",
      primaryBtnBorderC: "transparent",
      primaryBtnBorderW: "0",
      primaryBtnRadius: "8px",
      // Secondary button
      secondaryBtnBg: "transparent",
      secondaryBtnFS: "12px",
      secondaryBtnFW: "500",
      secondaryBtnFC: "white",
      secondaryBtnBorderC: "rgba(149, 176, 178, 0.50)",
      secondaryBtnBorderW: "2px",
      secondaryBtnRadius: "8px",
      // Markdown
      markdownBg: "#07131766",
      markdownFS: "12px",
      markdownFC: "#DADCE5",
      markdownBorderW: "0",
      markdownRadius: "4px",
      markdownBorderC: "black",
      markdownScrollbarC: "#DADCE5",
      // Wallet address
      walletBg: "#1a1a1a",
      walletFS: "10px",
      walletFW: "400",
      walletFC: "white",
      walletBorderC: "white",
      walletBorderW: "0",
      walletRadius: "4px",
      // Details of offering
      detailsBg: "#1a1a1a",
      detailsTitleFS: "15px",
      detailsTitleFW: "600",
      detailsTitleFC: "white",
      detailsSubtitleFS: "14px",
      detailsSubtitleFW: "500",
      detailsSubtitleFC: "#A8ADBF",
      detailsRadius: "8px",
      detailsBorderW: "0",
      detailsBorderC: "transparent",
      detailsAmountFC: "#00DFF3",
      detailsAmountFW: "700",
      // Overlay
      overlayBg: "#192E34E6",
      overlayFS: "13px",
      overlayFW: "400",
      overlayFC: "#DADCE5",
      loaderBg: "#0A2EC0",
      // Optout \ Turn off
      optoutBg: "#192E34",
      optoutFS: "14px",
      optoutFW: "400",
      optoutFC: "white",
      optoutRadius: "56px",
      // X Button and close buttons
      closeFS: "9px",
      closeFW: "300",
      closeFC: "#B9BBBF",
      // Token name
      tokenBg: "transparent",
      tokenFS: "13px",
      tokenFW: "600",
      tokenFC: "#DADCE5",
      tokenBorderW: "2px",
      tokenBorderC: "#DADCE5",
      // Notification popup
      notificationFS: "14px",
      notificationFW: "500",
      notificationFC: "white",
      notificationBtnBg: "linear-gradient(135deg, #00DFF3 0%, #FDFC47 100%)",
      notificationBtnFS: "12px",
      notificationBtnFW: "500",
      notificationBtnFC: "#041417",
      notificationBtnBorderW: "0",
      notificationBtnBorderC: "transparent",
      notificationBtnRadius: "8px",
      activateTitleFS: "--activate-title-f-s",
      activateTitleFW: "--activate-title-f-w",
      activateTitleFC: "--activate-title-f-c",
      activateTitleBoldFS: "--activate-title-bold-f-s",
      activateTitleBoldFW: "--activate-title-bold-f-w",
      activateTitleBoldFC: "--activate-title-bold-f-c",
    }
  });
}

if (shouldInject()) {
  injectScript();
  await injectBring();
  Messaging.createProxyController();
}
