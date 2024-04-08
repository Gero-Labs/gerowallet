import { environment } from '../../../angular/src/environments/environment';
import { AssetLabelUtils } from './asset-label.utils';

enum HandleClass {
  NFTSubHandle = 222,
  VirtualSubHandle = 314,
}

function hexToString(hex: string): string {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    const v = parseInt(hex.substr(i, 2), 16);
    if (v) str += String.fromCharCode(v);
  }

  return str;
}

function isCIP68Handle(handleClass: number) {
  return handleClass === HandleClass.NFTSubHandle || handleClass === HandleClass.VirtualSubHandle;
}

function isHandle(policyId: string): boolean {
  return policyId === environment.adaHandlePolicyId
}

function getHandleName(assetName: string): string {
  const assetLabel = AssetLabelUtils.extractLabel(assetName);

  if (isCIP68Handle(AssetLabelUtils.fromLabel(assetLabel))) {
    return hexToString(AssetLabelUtils.extractName(assetName));
  }

  return hexToString(assetName);
}

export const AdaHandleUtils = {
  isHandle,
  getHandleName,
}
