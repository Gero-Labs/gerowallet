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
  if (chrome?.runtime) {
    script.src = chrome.runtime.getURL('inject.js');

    (document.head || document.documentElement).appendChild(script);
  }
};

if (shouldInject()) {
  injectScript();
}

class APIError {

  message: string
  code: number

  constructor(message: string, code: number) {
    this.message = message;
    this.code = code;
  }
}

// Listen for messages from the injected script
window.addEventListener('message', async event => {
  if (event.source !== window) {
    return;
  }

  if (event.data?.type === 'FROM_PAGE') {
    let response
    try {
      response = await sendMessageToBackgroundScript({type: 'FROM_CONTENT', payload: event.data.payload,});
    } catch (error) {
      console.error('Error sending message to background:', error);
    }
    if (response?.data) {
      window.postMessage({ type: 'FROM_EXTENSION', data: response.data }, '*');
    } else if (response?.error) {
      throw new APIError(response.error.info, response.error.code)
    }
  }
});

function sendMessageToBackgroundScript(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}
