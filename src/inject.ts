const wallet = {
  name: 'gero',
  icon: '',
};

if (!window['cardano']) {
  window['cardano'] = {};
}

window['cardano'][wallet.name] = {
  apiVersion: '0.1',
  version: '0.1',
  name: wallet.name,
  icon: wallet.icon,
  enable: async (): Promise<Awaited<any>> => {
    try {
      await sendMessageToContentScript({
        action: 'enable',
        data: {url: window.location.href.toString()},
      });
    } catch (e) {
      return Promise.resolve(e);
    }
  },
  isEnabled: async () => {
    try {
      return await sendMessageToContentScript({
        action: 'isEnabled',
        data: {url: window.location.href.toString()},
      });
    } catch (e) {
      return Promise.resolve(e)
    }
  },
  getExtensions: async () => {
    try {
      return await sendMessageToContentScript({
        action: 'getExtensions',
      })
    } catch (e) {
      return Promise.reject(e);
    }
  },
  getNetworkId: async () => {
    try {
      return await sendMessageToContentScript({
        action: 'getNetworkId',
      })
    } catch (e) {
      return Promise.reject(e);
    }
  }
};

function sendMessageToContentScript(payload) {
  return new Promise((resolve, reject) => {
    const messageListener = event => {
      if (event.source !== window) {
        return;
      }

      if (event.data?.type === 'FROM_EXTENSION') {
        window.removeEventListener('message', messageListener);
        resolve(event.data.data);
      }
    };

    window.addEventListener('message', messageListener);
    window.postMessage({type: 'FROM_PAGE', payload}, '*');
  });
}
