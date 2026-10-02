/**
 * The MoonPay widget is embedded in an iframe inside the wallet's own pages
 * (BuySellSheet). MoonPay sends frame-ancestors / X-Frame-Options that forbid
 * that, so the wallet strips those two response headers for MoonPay frames.
 *
 * It must only do so for frames the WALLET opens. A static rule without an
 * initiator condition stripped them for every site in the browser, so any page
 * could frame MoonPay with its clickjacking protection removed. The initiator of
 * a frame inside an extension page is chrome-extension://<id>, whose host is the
 * extension id, and the id is only known at runtime, so this is a session rule
 * the background (re)installs at start-up.
 */
export const MOONPAY_FRAME_RULE_ID = 1;

export function moonpayFrameRule(extensionId: string): chrome.declarativeNetRequest.Rule {
  return {
    id: MOONPAY_FRAME_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      responseHeaders: [
        { header: 'content-security-policy', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
        { header: 'x-frame-options', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation },
      ],
    },
    condition: {
      urlFilter: '||moonpay.com^',
      resourceTypes: ['sub_frame' as chrome.declarativeNetRequest.ResourceType],
      initiatorDomains: [extensionId],
    },
  };
}

export async function installMoonpayFrameRule(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.declarativeNetRequest?.updateSessionRules) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [MOONPAY_FRAME_RULE_ID],
    addRules: [moonpayFrameRule(chrome.runtime.id)],
  });
}
