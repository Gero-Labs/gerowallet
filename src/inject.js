const wallet = {
  name: 'GeroWallet',
  icon: '',
};

if (!window.cardano) {
  window.cardano = {};
}

window.cardano[wallet.name] = {
  apiVersion: '0.1',
  version: '0.1',
  name: wallet.name,
  icon: wallet.icon,
  enable: async () => {
    try {
      await sendMessageToContentScript({
        action: 'enable',
        data: { url: window.location.href.toString() },
      });
    } catch (e) {
      console.log(e);
    }
  },
};

function sendMessageToContentScript(payload) {
  return new Promise((resolve, reject) => {
    const messageListener = event => {
      if (event.source !== window) {
        return;
      }

      if (event.data?.type == 'FROM_EXTENSION') {
        window.removeEventListener('message', messageListener);
        resolve(event.data);
      }
    };

    window.addEventListener('message', payload);
    window.postMessage({ type: 'FROM_PAGE', payload }, '*');
  });
}
