export enum MessagingTarget {
  gero = 'gero'
}

export enum MessagingSender {
  extension = 'extension',
  webpage = 'webpage',
}

export enum MessagingEvent {
  accountChange = 'accountChange'
}

/*
* Sends a message to the contentPage and waits for response.
* */
export function sendContentPageMessage<T>(message: any): Promise<T> {
  return new Promise(async (resolve, reject) => {
    const requestId = Math.random().toString(36).substr(2, 9);
    postContentPageMessage(message, requestId);

    try {
      const contentPageMessage = await listenContentPageMessage<any>(requestId);
      resolve(contentPageMessage)
    } catch (e) {
      reject(e);
    }
  });
}

/*
* Sends a message to the background.
* */
function postContentPageMessage(
  message: any,
  requestId: string
): void {
  window.postMessage(
    {
      ...message,
      target: MessagingTarget.gero,
      sender: MessagingSender.webpage,
      id: requestId
    },
    window.origin
  );
}

/*
* Listens for a message emitted to the contentPage.
* */
function listenContentPageMessage<T>(requestId: string): Promise<T>{
  return new Promise((resolve, reject) => {
    window.addEventListener('message', function responseHandler(e) {
      const response = e.data;
      if (
        typeof response !== 'object' ||
        response === null ||
        !response.target ||
        response.target !== MessagingTarget.gero ||
        !response.id ||
        response.id !== requestId ||
        !response.sender ||
        response.sender !== MessagingSender.extension
      )
        return;

      window.removeEventListener('message', responseHandler);
      response.error ? reject(response.error) : resolve(response);
    });
  });
}

export function fetchEnabled() {
  return new Promise<boolean>(async (resolve, reject) => {
    try {
        const message = { title: 'dapp-is-enabled' };
        const response = await sendContentPageMessage<any>(message);
        resolve(response.connected);
    } catch (e) {
        reject(e);
    }
  });
}

export function listenBackgroundEvents(){
  chrome.runtime.onMessage.addListener(async (response) => {
    if (
      typeof response !== 'object' ||
      response === null ||
      !response.target ||
      response.target !== MessagingTarget.gero ||
      !response.sender ||
      response.sender !== MessagingSender.extension ||
      !response.event
    ) {
      return;
    }

    const isEnabled = await fetchEnabled();
    if (!isEnabled) {
      return;
    }

    const event = new CustomEvent(`${MessagingTarget.gero}${response.event}`, {
      detail: response.data,
    });
  
    window.dispatchEvent(event);
  });

}
