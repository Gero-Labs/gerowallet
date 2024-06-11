console.log('start')
let lastFullscreenTabId = -1

// Function to get the logged wallet
function getLoggedWallet() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("loggedWallet", (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result['loggedWallet']);
      }
    });
  });
}

// Check if a specific tab is open
const checkTabOpen = (tabId) => {
  return new Promise((resolve) => {
    const url = chrome.runtime.getURL("*");
    chrome.tabs.query({ url }, function (tabList) {
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

// Open the dashboard in a new tab or focus an existing tab
const openDashboard = () => {
  return new Promise((resolve) => {
    checkTabOpen(lastFullscreenTabId).then((isOpen) => {
      if (!isOpen) {
        chrome.tabs.create({
          url: chrome.runtime.getURL("index.html"),
          active: true
        }, (tab) => {
          lastFullscreenTabId = tab?.id ?? -1;
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
        chrome.tabs.update(lastFullscreenTabId, { selected: true });
        chrome.windows.getAll({ populate: true, windowTypes: ["normal", "popup"] }, (list) => {
          for (const win of list) {
            if (win.id && win.tabs) {
              for (const tab of win.tabs) {
                if (tab.id === lastFullscreenTabId) {
                  chrome.windows.update(win.id, { focused: true });
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

// Open the UI
const openUI = async () => {
  await openDashboard();
};
if (chrome?.action) {
  chrome.action.onClicked.addListener(openUI);
}

if (chrome?.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (message.type === 'FROM_CONTENT') {
        if (message.payload.action === 'enable') {
          const wallet = await getLoggedWallet();
          if (!isEmpty(wallet)) {
            const popupURL = chrome.runtime.getURL(`index.html#/dapp-connect?website=${message.payload.data.url}`);
            focusOrCreateWindow(popupURL);
          } else {
            sendResponse({ error: { code: -2, info: "No Account Set" } });
          }
        } else if (message.payload.action === 'isEnabled') {
          sendResponse({ data: true });
        } else if (message.payload.action === 'getExtensions') {
          sendResponse({ data: [] });
        } else if (message.payload.action === 'getNetworkId') {
          sendResponse({ data: 1 });
        }
      } else {
        sendResponse({ data: undefined });
      }
    })();
    return true;
  });
}

// Focus or create a new window
function focusOrCreateWindow(url) {
  chrome.windows.getAll({ populate: true }, (windows) => {
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
      chrome.windows.update(existingWindow.id, { focused: true });
    } else {
      // Create a new window with the specified URL
      chrome.windows.create({ url: url, type: 'popup', width: 470, height: 680 }, (win) => {
        // Focus the newly created window
        if (win.id) {
          chrome.windows.update(win.id, { focused: true });
        }
      });
    }
  });
}

function isEmpty(obj) {
  for (const prop in obj) {
    if (Object.hasOwn(obj, prop)) {
      return false;
    }
  }

  return true;
}
