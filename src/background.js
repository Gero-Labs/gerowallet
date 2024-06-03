import Dexie from "dexie";

let lastFullscreenTabId = -1;

const checkTabOpen = (tabId) => {
  return new Promise((resolve) => {
    const url = chrome.runtime.getURL("*");
    chrome.tabs.query({url}, function (tabList) {
      let isTabOpen = false;
      for (let i = 0; i < tabList.length; i++) {
        const tmpTab = tabList[i];
        if (tmpTab && tmpTab.id === tabId) {
          isTabOpen = true;
          break;
        }
      }
      resolve(isTabOpen);
    });
  });
};

const openDashboard = () => {
  return new Promise((resolve) => {
    checkTabOpen(lastFullscreenTabId).then((isOpen) => {
      if (!isOpen) {
        chrome.tabs.create({
          url: chrome.runtime.getURL("index.html"),
          active: true
        }, (tab) => {
          lastFullscreenTabId = tab.id ?? -1;
          const popupTabId = lastFullscreenTabId;
          const handleRemove = (tabId) => {
            if (tabId === popupTabId) {
              chrome.tabs.onRemoved.removeListener(handleRemove);
            }
          };
          chrome.tabs.onRemoved.addListener(handleRemove);
          return resolve(true);
        });
      } else {
        chrome.tabs.update(lastFullscreenTabId, {selected: true});
        chrome.windows.getAll({populate: true, windowTypes: ["normal", "popup"]}, (list) => {
          for (const win of list) {
            console.log(win);
            if (win.id && win.tabs) {
              for (const tab of win.tabs) {
                if (tab.id === lastFullscreenTabId) {
                  chrome.windows.update(win.id, {focused: true});
                  break;
                }
              }
            }
          }
        });
        resolve(true);
      }
    });
  });
};

const openUI = async () => {
  await openDashboard();
};
chrome.action.onClicked.addListener(openUI);


/* CIP 30 */
chrome.action.onClicked.addListener(tab => {
  const appUrl = chrome.runtime.getURL('index.html');
  chrome.tabs.query({url: appUrl}, tabs => {
    if (tabs.length > 0) {
      // If a tab of your app is already opened, focus it
      chrome.tabs.update(tabs[0].id, {active: true});
    } else {
      // If no tab of your app is opened, open a new tab
      chrome.tabs.create({url: appUrl});
    }
  });
});

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'FROM_CONTENT') {
    if (message.payload.action === 'enable') {
      // TODO: Eugeniu, encode properly the query params.
      const popupURL = chrome.runtime.getURL(
        `index.html#/dapp-connect?website=${message.payload.data.url}&walletName=MyWallet`
      );

      focusOrCreateWindow(popupURL);
    } else if (message.payload.action === 'isEnabled') {
      sendResponse({data: true})
    } else if (message.payload.action === 'getExtensions') {
      sendResponse({data: []});
    } else if (message.payload.action === 'getNetworkId') {
      sendResponse({data: 1});
    }
  } else if (message.type === 'FROM_POPUP') {
    if (message.action === 'initializeConfigTable') {
      await initializeConfigTable();
      sendResponse(true);
    } else if (message.action === 'initializeProviderTable') {
      await initializeProviderTable();
      sendResponse(true);
    }
  }

  sendResponse({data: undefined});
});

function focusOrCreateWindow(url) {
  chrome.windows.getAll({populate: true}, windows => {
    let existingWindow = null;

    // Iterate through each window and its tabs to find the URL
    for (const window of windows) {
      for (const tab of window.tabs) {
        if (tab.url === url) {
          existingWindow = window;
          break;
        }
      }
      if (existingWindow) break;
    }

    if (existingWindow) {
      // Focus on the existing window
      chrome.windows.update(existingWindow.id, {focused: true});
    } else {
      // Create a new window with the specified URL
      chrome.windows.create({
        url: url,
        type: 'popup',
        width: 400,
        height: 600,
      });
    }
  });
};

/* DEXIE */

async function initializeDexieDatabase() {
  const db = new Dexie('GeroWalletDatabase');

  await db.version(1).stores({
    wallets: '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network',
    config: '++id, key, value',
    provider: '++id, [name+chain+network], baseUrl, apiKey',
  });

  db.open().catch(err => {
    console.error(`Failed to open database: ${err.stack || err}`);
  });
}

async function initializeConfigTable() {
  await db['config'].toArray().then(async rows => {
    if (rows.length === 0) {
      const initialData = [{key: 'provider', value: Provider.KOIOS}];
      await db['config'].bulkAdd(initialData).catch(error => {
        console.error('Error adding initial data:', error);
      });
    }
  });
}

async function initializeProviderTable() {
  await db['provider'].toArray().then(async rows => {
    if (rows.length === 0) {
      const initialData = [
        {
          name: Provider.KOIOS,
          chain: Blockchain.CARDANO,
          network: Network.MAINNET,
          baseUrl: 'https://api.koios.rest/api/v1/',
          apiKey: null
        },
        {
          name: Provider.KOIOS,
          chain: Blockchain.CARDANO,
          network: Network.PREPROD,
          baseUrl: 'https://preprod.koios.rest/api/v1/',
          apiKey: null
        },
        {
          name: Provider.KOIOS,
          chain: Blockchain.CARDANO,
          network: Network.PREVIEW,
          baseUrl: 'https://preview.koios.rest/api/v1/',
          apiKey: null
        },
        {
          name: Provider.KOIOS,
          chain: Blockchain.APEX_PRIME,
          network: Network.TESTNET,
          baseUrl: 'http://apex-prime-testnet.gerowallet.io:8053/',
          apiKey: null
        }
      ];
      await db['provider'].bulkAdd(initialData).catch(error => {
        console.error('Error adding initial data:', error);
      });
    }
  });
}


await initializeDexieDatabase();

