import { Message } from '@/messaging/types';

export const sendMessageToBackground = <T>(message: Message): Promise<T> => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({type: 'FROM_POPUP', ...message}, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}
