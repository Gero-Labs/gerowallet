import { Network } from '@/models/types';
import type { SpendBound } from '@/shared/utils/txIntentGuard';
import { NO_ORDER_LOVELACE, ORDER_LEG_FLOOR_LOVELACE } from '@/modules/swap/composables/orderSpendBound';
import { REALFI_ASSETS } from '../assets';
import type { RealFiBuildRequest } from './realfiOrders';

/**
 * How much a RealFi order built by Nexus may take from the wallet: staking
 * locks the USDrf amount the user entered, unstaking the sUSDrf amount, plus the
 * order's ADA leg. Claims and cancels give value back and may take almost nothing.
 */
export function realfiSpendBound(req: RealFiBuildRequest, network: string | undefined): SpendBound {
  const assets = network === Network.MAINNET ? REALFI_ASSETS.mainnet
    : network === Network.PREPROD ? REALFI_ASSETS.preprod
      : null;
  if ((req.kind === 'stake' || req.kind === 'unstake') && assets) {
    const unit = req.kind === 'stake' ? assets.usdr : assets.susdr;
    return {
      maxOutflow: new Map([
        ['lovelace', ORDER_LEG_FLOOR_LOVELACE],
        [unit, BigInt(req.amount)],
      ]),
    };
  }
  return { maxOutflow: new Map([['lovelace', NO_ORDER_LOVELACE]]) };
}
