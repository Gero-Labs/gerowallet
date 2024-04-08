import { listenBackgroundEvents, MessagingSender, MessagingTarget } from './dAppConnector/messaging';

const shouldInject = () => {
    const documentElement = document.documentElement.nodeName;
    const docElemCheck = documentElement ? documentElement.toLowerCase() === 'html' : true;
    const { doctype } = window.document;
    const docTypeCheck = doctype ? doctype.name === 'html' : true;
    return docElemCheck && docTypeCheck;
};

const injectScript = () => {
    const script = document.createElement('script');
    script.async = false;
    script.src = chrome.runtime.getURL('inject.js');

    (document.head || document.documentElement).appendChild(script);
};

if (shouldInject()) {
    injectScript();
}

listenBackgroundEvents();

//listen to function calls from webpage
window.addEventListener('message', (event) => {
    // Only accept messages from the same frame
    if (event.source !== window) {
        return;
    }
    const message = event.data;
    // Only accept messages that we know are ours
    if (typeof message !== 'object' || message === null || message.target !== MessagingTarget.gero || message.sender !== MessagingSender.webpage) {
        return;
    }

    chrome.runtime.sendMessage({ ...message, target: MessagingTarget.gero, sender: MessagingSender.webpage }, (response) => {
        if (chrome.runtime.lastError) {
            return;
        }

        window.postMessage(
            {
                ...response,
                target: MessagingTarget.gero,
                sender: MessagingSender.extension,
                id: message.id,
            },
            window.origin,
        );
    });
});
