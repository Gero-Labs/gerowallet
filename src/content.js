injectScript(chrome.runtime.getURL('inject.js'));

// Listen for messages from the injected script
window.addEventListener('message', async event => {
  if (event.source !== window) {
    return;
  }

  if (event.data?.type == 'FROM_PAGE') {
    try {
      const response = await sendMessageToBackgroundScript({
        type: 'FROM_CONTENT',
        payload: event.data.payload,
      });
      window.postMessage({ type: 'FROM_EXTENSION', text: response.reply }, '*');
    } catch (error) {
      console.error('Error sending message to background:', error);
    }
  }
});

function injectScript(file) {
  const scriptElement = document.createElement('script');

  scriptElement.setAttribute('type', 'module');
  scriptElement.setAttribute('src', file);

  document.head.appendChild(scriptElement);
}

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
