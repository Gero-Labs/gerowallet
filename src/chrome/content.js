import { Messaging } from './messaging';


const injectScript = () => {
  const script = document.createElement('script');
  script.async = false;
  if (chrome?.runtime) {
    script.src = chrome.runtime.getURL('js/inject.js');
  }
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
};

function shouldInject() {
  const documentElement = document.documentElement.nodeName;
  const docElemCheck = documentElement
    ? documentElement.toLowerCase() === 'html'
    : true;
  const { docType } = window.document;
  const docTypeCheck = docType ? docType.name === 'html' : true;
  return docElemCheck && docTypeCheck;
}

if (shouldInject) {
  injectScript();
  Messaging.createProxyController();
}
