import { Database } from '@/chrome/database';
import { PopupMessageAction } from '@/chrome/messaging';

let lastFullscreenTabId = -1;

const db = new Database('GeroWallet');
await db.init();

/* Window Management */

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
}

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
      // TODO: encode properly the query params.
      const popupURL = chrome.runtime.getURL(
        `index.html#/dapp-connect?website=${message.payload.data.url}&walletName=MyWallet`
      );

      focusOrCreateWindow(popupURL);
    } else if (message.payload.action === 'isEnabled') {
      // TODO: Implement
      sendResponse({data: true})
    } else if (message.payload.action === 'getExtensions') {
      // TODO: Implement
      sendResponse({data: []});
    } else if (message.payload.action === 'getNetworkId') {
      // TODO: Implement
      sendResponse({data: 1});
    }
  } else if (message.type === 'FROM_POPUP') {
    const action: PopupMessageAction = message.action;

    if (action === 'initializeConfigTable') {
      await db.initializeConfigTable();
      sendResponse(true);
    } else if (action === 'initializeProviderTable') {
      await db.initializeProviderTable();
      sendResponse(true);
    } else if (action === 'getProvider') {
      const provider = await db.getProvider(message.payload.data.chain, message.payload.data.network);
      sendResponse(provider);
    } else if (action === 'getConfiguration') {
      const configuration = await db.getConfiguration(message.payload.data.key);
      sendResponse(configuration);
    } else if (action === 'getAllWallets') {
      const wallets = db.getAllWallets();
      sendResponse(wallets);
    } else if (action === 'getLatestWalletByOrder') {
      const wallet = db.getLatestWalletByOrder();
      sendResponse(wallet);
    } else if (action === 'createNewWallet') {
      const walletId = db.createNewWallet(message.payload.data);
      sendResponse(walletId);
    } else if (action === 'createNewHardwareWallet') {
      const walletId = db.createNewHardwareWallet(data);
      sendResponse(walletId);
    } else if (action === 'createNewWalletDb') {
      await db.createNewWalletDb(message.action.payload.data.walletId);
      sendResponse(true);
    } else if (action === 'loadSync') {
      // TODO: Implement via long lived connection
      sendResponse(true);
    } else if (action === 'loadRewards') {
      // TODO: Implement via long lived connection
      sendResponse(true);
    } else if (action === 'loadAccountInfo') {
      // TODO: Implement via long lived connection
      sendResponse(true);
    } else if (action === 'loadTransactions') {
      // TODO: Implement via long lived connection
      sendResponse(true);
    } else if (action === 'loadPools') {
      // TODO: Implement via long lived connection
      sendResponse(true);
    }
  }

  sendResponse({data: undefined});
});
