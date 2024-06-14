import {
  createPopup, getStorage,
  // extractKeyHash,
  // getAddress,
  // getBalance,
  // getCollateral,
  // getNetwork,
  // getRewardAddress,
  // getUtxos,
  isWhitelisted,
  // submitTx,
  // verifyPayload,
  // verifyTx,
} from './extension';
import { Messaging } from './messaging';
import {
  APIError,
  METHOD,
  NETWORKD_ID_NUMBER,
  POPUP,
  SENDER, STORAGE,
  TARGET,
} from './config';
console.log('Background Loaded')

let lastFullscreenTabId = -1

const app = Messaging.createBackgroundController();

/**
 * listens to requests from the web context
 */
// app.add(METHOD.getBalance, (request, sendResponse) => {
//   getBalance()
//     .then((value) => {
//       sendResponse({
//         id: request.id,
//         data: Buffer.from(value.to_bytes(), 'hex').toString('hex'),
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     })
//     .catch((e) => {
//       sendResponse({
//         id: request.id,
//         error: e,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     });
// });

app.add(METHOD.enable, async (request, sendResponse) => {
  const loggedWallet = await getStorage(STORAGE.loggedWallet)
  if (!loggedWallet) {
    sendResponse({
      id: request.id,
      error: APIError.AccountNotSet,
      target: TARGET,
      sender: SENDER.extension,
    })
  } else {
    isWhitelisted(request.origin)
      .then(async (whitelisted) => {
        if (whitelisted) {
          sendResponse({
            id: request.id,
            data: true,
            target: TARGET,
            sender: SENDER.extension,
          });
        } else {
          const response = await createPopup(POPUP.internal)
            .then((tab) => Messaging.sendToPopupInternal(tab, request))
            .then((response) => response);
          if (response.data === true) {
            sendResponse({
              id: request.id,
              data: true,
              target: TARGET,
              sender: SENDER.extension,
            });
          } else if (response.error) {
            sendResponse({
              id: request.id,
              error: response.error,
              target: TARGET,
              sender: SENDER.extension,
            });
          } else {
            sendResponse({
              id: request.id,
              error: APIError.InternalError,
              target: TARGET,
              sender: SENDER.extension,
            });
          }
        }
      })
      .catch(() =>
        sendResponse({
          id: request.id,
          error: APIError.InternalError,
          target: TARGET,
          sender: SENDER.extension,
        })
      );
  }
});

app.add(METHOD.isEnabled, (request, sendResponse) => {
  isWhitelisted(request.origin)
    .then((whitelisted) => {
      sendResponse({
        id: request.id,
        data: whitelisted,
        target: TARGET,
        sender: SENDER.extension,
      });
    })
    .catch(() => {
      sendResponse({
        id: request.id,
        error: APIError.InternalError,
        target: TARGET,
        sender: SENDER.extension,
      });
    });
});

// app.add(METHOD.getAddress, async (request, sendResponse) => {
//   const address = await getAddress();
//   if (address) {
//     sendResponse({
//       id: request.id,
//       data: address,
//       target: TARGET,
//       sender: SENDER.extension,
//     });
//   } else {
//     sendResponse({
//       id: request.id,
//       error: APIError.InternalError,
//       target: TARGET,
//       sender: SENDER.extension,
//     });
//   }
// });

// app.add(METHOD.getRewardAddress, async (request, sendResponse) => {
//   const address = await getRewardAddress();
//   if (address) {
//     sendResponse({
//       id: request.id,
//       data: address,
//       target: TARGET,
//       sender: SENDER.extension,
//     });
//   } else {
//     sendResponse({
//       id: request.id,
//       error: APIError.InternalError,
//       target: TARGET,
//       sender: SENDER.extension,
//     });
//   }
// });

// app.add(METHOD.getUtxos, (request, sendResponse) => {
//   getUtxos(request.data.amount, request.data.paginate)
//     .then((utxos) => {
//       utxos = utxos
//         ? utxos.map(
//           (utxo) => Buffer.from(utxo.to_bytes(), 'hex').toString('hex') // LEGACY support => TODO change in the future
//         )
//         : null;
//       sendResponse({
//         id: request.id,
//         data: utxos,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     })
//     .catch((e) => {
//       sendResponse({
//         id: request.id,
//         error: e,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     });
// });

// app.add(METHOD.getCollateral, (request, sendResponse) => {
//   getCollateral()
//     .then((utxos) => {
//       utxos = utxos.map((utxo) =>
//         Buffer.from(utxo.to_bytes(), 'hex').toString('hex')
//       );
//       sendResponse({
//         id: request.id,
//         data: utxos,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     })
//     .catch((e) => {
//       sendResponse({
//         id: request.id,
//         error: e,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     });
// });

// app.add(METHOD.submitTx, (request, sendResponse) => {
//   submitTx(request.data)
//     .then((txHash) => {
//       sendResponse({
//         id: request.id,
//         data: txHash,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     })
//     .catch((e) => {
//       sendResponse({
//         id: request.id,
//         target: TARGET,
//         error: e,
//         sender: SENDER.extension,
//       });
//     });
// });

app.add(METHOD.isWhitelisted, async (request, sendResponse) => {
  const whitelisted = await isWhitelisted(request.origin);
  if (whitelisted) {
    sendResponse({
      data: whitelisted,
      target: TARGET,
      sender: SENDER.extension,
    });
  } else {
    sendResponse({
      error: APIError.Refused,
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});

// app.add(METHOD.getNetworkId, async (request, sendResponse) => {
//   const network = await getNetwork();
//   if (network)
//     sendResponse({
//       id: request.id,
//       data: NETWORKD_ID_NUMBER[network.id],
//       target: TARGET,
//       sender: SENDER.extension,
//     });
//   else
//     sendResponse({
//       id: request.id,
//       error: APIError.InternalError,
//       target: TARGET,
//       sender: SENDER.extension,
//     });
// });

// app.add(METHOD.signData, async (request, sendResponse) => {
//   try {
//     verifyPayload(request.data.payload);
//     await extractKeyHash(request.data.address);
//
//     const response = await createPopup(POPUP.internal)
//       .then((tab) => Messaging.sendToPopupInternal(tab, request))
//       .then((response) => response);
//
//     if (response.data) {
//       sendResponse({
//         id: request.id,
//         data: response.data,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     } else if (response.error) {
//       sendResponse({
//         id: request.id,
//         error: response.error,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     } else {
//       sendResponse({
//         id: request.id,
//         error: APIError.InternalError,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     }
//   } catch (e) {
//     sendResponse({
//       id: request.id,
//       error: e,
//       target: TARGET,
//       sender: SENDER.extension,
//     });
//   }
// });

// app.add(METHOD.signTx, async (request, sendResponse) => {
//   try {
//     await verifyTx(request.data.tx);
//     const response = await createPopup(POPUP.internal)
//       .then((tab) => Messaging.sendToPopupInternal(tab, request))
//       .then((response) => response);
//
//     if (response.data) {
//       sendResponse({
//         id: request.id,
//         data: response.data,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     } else if (response.error) {
//       sendResponse({
//         id: request.id,
//         error: response.error,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     } else {
//       sendResponse({
//         id: request.id,
//         error: APIError.InternalError,
//         target: TARGET,
//         sender: SENDER.extension,
//       });
//     }
//   } catch (e) {
//     sendResponse({
//       id: request.id,
//       error: e,
//       target: TARGET,
//       sender: SENDER.extension,
//     });
//   }
// });

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

const openUI = async () => {
  await openDashboard();
};

if (chrome?.action) {
  chrome.action.onClicked.addListener(openUI);
}

app.listen();
