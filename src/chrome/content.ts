import { Messaging } from './messaging';
import { bringInitContentScript } from '@bringweb3/chrome-extension-kit';
import { getAddressBech32 } from "@/chrome/webpage";

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
  // bringInitContentScript({
  //   iframeEndpoint: 'https://dev-extension.bringweb3.io/', //https://extension.bringweb3.io/
  //   getWalletAddress: () => Promise<WalletAddress>(),
  //   promptLogin: () => Promise<WalletAddress>,
  //   walletAddressListeners: string[],
  //   customTheme: Style
  // });
  await bringInitContentScript({
    iframeEndpoint: 'https://dev-extension.bringweb3.io/',
    getWalletAddress,
    promptLogin: async () => await new Promise(resolve => setTimeout(() => resolve('addr1q8nj08tfwzjmzrmcl9y25dtpl6wxjdgy59z5mt5lppc88s7y6ald4epue5t6fesxemr3h857wv8aavjht4cpfrc26les2tmzw0'), 4000)), //prompt login
    walletAddressListeners: ['gero:login', 'gero:logout']
  });
}

if (shouldInject()) {
  // console.log('test')
  // const address = await getWalletAddress()
  // console.log('GerowalletAddress', address)
  injectScript();
  await injectBring();
  Messaging.createProxyController();
}
