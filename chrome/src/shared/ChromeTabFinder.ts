import { autoInjectable, singleton } from 'tsyringe';

@singleton()
@autoInjectable()
export class ChromeTabFinder {
    isTab = (message: string): number | null => {
        let myTabId = null;
        const geroURL = `chrome-extension://${chrome.runtime.id}/`;
        let tabFound = false;
        const messagesToUpdateTab = ['import', 'create', 'hardware-options', 'done', 'expand'];
        chrome.tabs.query({ currentWindow: true }, (tabs) => {
            for (let x = 0; x < tabs.length; x++) {
                const tabUrl = tabs[x].url;
                const tabId = tabs[x].id;
                if (tabUrl.startsWith(geroURL)) {
                    if (tabFound || message == 'is-popup') {
                        chrome.tabs.remove(tabId);
                        tabFound = false;
                    } else {
                        if (messagesToUpdateTab.includes(message)) {
                            chrome.tabs.update(tabId, { selected: true });
                            tabFound = true;
                            myTabId = tabId;
                        }
                    }
                }
            }
        });
        return myTabId;
    };
}
