/* eslint-disable prettier/prettier */

import { BehaviorSubject } from "rxjs";
import { skip, take } from "rxjs/operators";

export class PopupService {
    private height = 700;
    private width = 380;
    private activeTabId: number = null;
    private activePopupId: number = null;
    private result = new BehaviorSubject<string>(undefined);

    constructor() {
        chrome.runtime.onMessage.addListener((req, sender) => {
            if (req && (!!sender?.tab?.windowId && !!sender?.tab?.id && sender.tab.windowId === this.activePopupId) && (req.message === 'swap-confirmation' || req.message === 'sign-data-confirmation')){
                this.result.next(req.password);
                if(req.isTrezor === true && req.message === 'swap-confirmation'){
                    // we add a small delay to close the popup, so new Trezor script takes the activeTabId.
                    setTimeout(() => {
                        this.closePopup();
                    }, 1000);
                    return true;
                }
                this.closePopup();
            }
            if (req && !!sender?.tab?.windowId && !!sender?.tab?.id && sender.tab.windowId === this.activePopupId && req.connected && req.connected === true){
                this.result.next('connected');
            }
            return true;
        });

        chrome.windows.onRemoved.addListener(() => {
            this.activePopupId = null;
            this.activeTabId = null;
            this.result.next(undefined);
        });
    }

    public showPopup(path: string, active = false, saveTrezorPopupId = false): Promise<string> {
        if (!!this.activePopupId) {
            this.updatePopup(path);
        } else {
            this.createPopup(path, active, saveTrezorPopupId);
        }
        return this.result.asObservable().pipe(skip(1), take(1)).toPromise();
    }

    public closePopup(): void {
        if (!!this.activePopupId) {
            chrome.windows.remove(this.activePopupId);
        }
    }

    private createPopup(path: string, active = false, saveTrezorPopupId = false): void {

        if(saveTrezorPopupId){
            const trezorPopup = localStorage.getItem('trezorPopupId');
            if(!!trezorPopup){
                chrome.windows.remove(+trezorPopup);
            }
        }
        chrome.tabs.create({
            url: chrome.extension.getURL(path),
            active
        }, (tab) => {
            this.activeTabId = tab.id;
            chrome.windows.create({
                tabId: tab.id,
                type: 'panel',
                focused: true,
                height: this.height,
                width: this.width,
            }, (window) => {
                this.activePopupId = window.id;
                if(saveTrezorPopupId){
                    localStorage.setItem('trezorPopupId', this.activePopupId.toString());
                }
            });
        });
    }

    private updatePopup(path: string): void {
        chrome.tabs.update(this.activeTabId, {
            url: chrome.extension.getURL(path), active: true
        }, () => chrome.windows.update(this.activePopupId, { focused: true })
        );
    }
}
