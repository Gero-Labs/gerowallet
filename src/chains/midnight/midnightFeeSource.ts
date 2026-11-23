// Who pays the DUST fee of a Midnight send. Three sources, in this order:
//
//   own        the sending wallet's DUST
//   feeWallet  another wallet the user owns and chose ("sponsor", midnightSponsor*.ts)
//   station    Gero's fee station (midnightStation*.ts), for ADA stakers
//
// The station is used only when the first two cannot pay.

export type MidnightFeeSource = 'own' | 'feeWallet' | 'station';

export interface MidnightFeeSourceInputs {
  /** The wallet may be unable to pay its own fee (`mayLackDustLive`). */
  mayLackDust: boolean;
  /** The user chose another of their wallets to pay. */
  feeWalletChosen: boolean;
  /** The station can be offered now (flag, network, eligibility). */
  stationAvailable: boolean;
  /** The user asked to try with the wallet's own DUST instead. */
  stationOptedOut: boolean;
  /** Shielded sends are not station-paid in this version. */
  shielded: boolean;
}

export function chooseMidnightFeeSource(inputs: MidnightFeeSourceInputs): MidnightFeeSource {
  if (!inputs.mayLackDust) return 'own';
  if (inputs.feeWalletChosen) return 'feeWallet';
  if (inputs.stationAvailable && !inputs.stationOptedOut && !inputs.shielded) return 'station';
  return 'own';
}
