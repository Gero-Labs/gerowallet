// import { db } from './database/GeroWalletDatabase';
// import { MessageController } from './messaging/MessageController';
// import { LogService } from './services/log.service';
// import { MessageRequestFactory } from './messaging/core/MessageRequestFactory';
// import { AsyncLoader } from './shared/AsyncLoader';
//
// db.open();
// AsyncLoader.load();
//
// var geroURL = `chrome://${chrome.runtime.id}/`;
//
// const messageController = new MessageController(new MessageRequestFactory());

// chrome.runtime.onMessage.addListener((message, sender, response) => {
//     let tabFound = false;
//     let tabToUpdate = undefined;
//     chrome.tabs.query({ currentWindow: true }, (tabs) => {
//         const geroTab = tabs.find((tab) => tab.url.startsWith(geroURL));
//         if (geroTab) {
//             tabToUpdate = geroTab.id;
//             tabFound = true;
//         }
//         try {
//             messageController.handleMessageRequest(message, sender, response, { tabFound, tabToUpdate });
//         } catch (err) {
//             new LogService().log('messages error: ' + err);
//         }
//     });
//     return true;
// });

chrome.action.onClicked.addListener((tab) => {
    const appUrl = chrome.runtime.getURL("index.html");
    chrome.tabs.query({url: appUrl}, (tabs)=> {
        if (tabs.length > 0) {
            // If a tab of your app is already opened, focus it
            chrome.tabs.update(tabs[0].id, {active: true});
        } else {
            // If no tab of your app is opened, open a new tab
            chrome.tabs.create({url: appUrl});
        }
    });
});