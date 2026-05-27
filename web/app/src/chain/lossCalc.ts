export interface LossBreakdown { loss: bigint; covered: bigint; cap: bigint; net: bigint; }
export function computeLoss(posBefore: bigint, posAfter: bigint, sumInsured: bigint, coinsBps: bigint, bps: bigint): LossBreakdown {
  const loss = posBefore > posAfter ? posBefore - posAfter : 0n;
  const covered = loss < sumInsured ? loss : sumInsured;
  const net = (covered * coinsBps) / bps;
  return { loss, covered, cap: sumInsured, net };
}
