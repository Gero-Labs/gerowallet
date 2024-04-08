import MessageSender = chrome.runtime.MessageSender;



export interface MessageRequestInterface {
    message: string;
    params: {};
    cb?(...args: any): any;
    sender?: MessageSender;
    tabFound: boolean;
    tabToUpdate: number | undefined;
}
