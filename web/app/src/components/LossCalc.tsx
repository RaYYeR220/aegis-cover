import { computeLoss } from "../chain/lossCalc";
import { fmtSTT, pctFromBps } from "../chain/format";

// The AI decides IF it pays (trigger); the math here is HOW MUCH. The Net payout figure has three
// honest states for the connected wallet:
//   "revealed" — a real settlement exists (claimable now, or already paid out): show the amount.
//   "pending"  — a verdict is in flight: show "pending verdict".
//   "none"     — no settlement for this wallet (no policy / not your loss): show "—", never a phantom.
export type PayoutState = "revealed" | "pending" | "none";

interface Props {
  positionBefore: bigint;
  positionAfter: bigint;
  sumInsured: bigint;
  coinsuranceBps: bigint;
  bps: bigint;
  payoutState?: PayoutState;
}

// Loss-calculation table — ported from mockup 2025–2053.
export function LossCalc({ positionBefore, positionAfter, sumInsured, coinsuranceBps, bps, payoutState = "revealed" }: Props) {
  const { covered, cap, net } = computeLoss(positionBefore, positionAfter, sumInsured, coinsuranceBps, bps);
  return (
    <div className="loss-calc">
      <div className="loss-row">
        <span className="loss-key">Value before</span>
        <span className="loss-val">{fmtSTT(positionBefore)} STT</span>
      </div>
      <div className="loss-row">
        <span className="loss-key">Value after</span>
        <span className="loss-val">{fmtSTT(positionAfter)} STT</span>
      </div>
      <div className="loss-row">
        <span className="loss-key">Loss</span>
        <span className="loss-val">{fmtSTT(covered)} STT</span>
      </div>
      <div className="loss-row">
        <span className="loss-key">Cover limit</span>
        <span className="loss-val">{fmtSTT(cap)} STT</span>
      </div>
      <div className="loss-row">
        <span className="loss-key">Covered share</span>
        <span className="loss-val">{pctFromBps(coinsuranceBps)}</span>
      </div>
      <div className="loss-row net-payout">
        <span className="loss-key">Payout</span>
        {payoutState === "revealed" ? (
          <span className="loss-val">{fmtSTT(net)} STT</span>
        ) : (
          <span className="loss-val" style={{ color: "var(--text3)", fontWeight: 400 }}>
            {payoutState === "pending" ? "pending verdict" : "—"}
          </span>
        )}
      </div>
    </div>
  );
}
