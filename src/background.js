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