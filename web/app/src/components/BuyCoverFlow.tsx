import { useEffect, useRef, useState } from "react";
import { type Address, type WalletClient } from "viem";
import { ADDR, publicClient, txUrl } from "../chain/config";
import { aegisCoverAbi, adapterAbi } from "../chain/abi";
import { fmtSTT, riskBand, shortAddr, pctFromBps } from "../chain/format";
import type { Listing, PerilName } from "../hooks/useChainReads";

// Cover-type enum on AegisCover. The peril is fixed per registered target, so the buyer doesn't pick it.
const COVER_TYPE_ENUM: Record<PerilName, number> = {
  Exploit: 0, Depeg: 1, Bridge: 2, Slashing: 3, Oracle: 4, Governance: 5, Other: 0,
};
const DURATION_OPTS = [30, 90, 365];

interface QuoteState {
  riskLabel: string;
  rateLabel: string;
  premiumWei: bigint;
  coverageWei: bigint;
}

interface Props {
  onClose: () => void;
  onPolicyBought: () => void;
  account: Address;
  walletClient: WalletClient;
  listings: Listing[];      // active registry targets the buyer can insure
  preselect?: Address;      // optional target to open on (from a marketplace card)
}

export function BuyCoverFlow({ onClose, onPolicyBought, account, walletClient, listings, preselect }: Props) {
  const [step, setStep] = useState(1);
  const [targetAddr, setTargetAddr] = useState<Address>(preselect ?? listings[0]?.target ?? ("0x" as Address));
  const [pct, setPct] = useState(100);
  const [duration, setDuration] = useState(90);
  const [position, setPosition] = useState(0n);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyTxHash, setBuyTxHash] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [confirmDetail, setConfirmDetail] = useState("");

  const selected = listings.find((l) => l.target.toLowerCase() === targetAddr.toLowerCase()) ?? listings[0];
  const peril: PerilName = selected?.peril ?? "Exploit";

  // The buyer's on-chain position in the selected target (coverage is capped at it).
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    publicClient
      .readContract({ address: selected.adapter, abi: adapterAbi, functionName: "positionOf", args: [account] })
      .then((p) => { if (alive) setPosition(p as bigint); })
      .catch(() => { if (alive) setPosition(0n); });
    return () => { alive = false; };
  }, [selected?.adapter, account]);

  const sumInsuredWei = (position * BigInt(pct)) / 100n;
  const durationSecs = BigInt(duration * 86400);

  async function buildQuote() {
    if (!selected) return;
    setQuoteLoading(true);
    try {
      let premiumWei = 0n;
      try {
        premiumWei = (await publicClient.readContract({
          address: ADDR.cover, abi: aegisCoverAbi, functionName: "quotePremium",
          args: [selected.target, sumInsuredWei, durationSecs],
        })) as bigint;
      } catch { /* not assessed yet → 0 */ }
      const { band } = riskBand(selected.riskScore);
      setQuote({
        riskLabel: selected.riskAssessed ? `${band} · ${selected.riskScore}/100` : "not yet rated",
        rateLabel: selected.riskAssessed ? pctFromBps(selected.rateBps) : "—",
        premiumWei,
        coverageWei: sumInsuredWei,
      });
    } finally {
      setQuoteLoading(false);
    }
  }

  function assessedAgo(): string {
    if (!selected?.riskAssessed || selected.riskAssessedAt === 0n) return "not yet";
    const diff = Math.floor(Date.now() / 1000) - Number(selected.riskAssessedAt);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  async function doBuy() {
    if (!selected) return;
    setBuying(true);
    setBuyError(null);
    try {
      const hash = await walletClient.writeContract({
        address: ADDR.cover, abi: aegisCoverAbi, functionName: "buyPolicy",
        args: [selected.target, COVER_TYPE_ENUM[peril], sumInsuredWei, durationSecs],
        value: quote?.premiumWei ?? 0n, account, chain: undefined, gas: 3_000_000n,
      });
      setBuyTxHash(hash);
      // Wait for the policy to actually mine before refreshing — otherwise the reload reads stale
      // state and "Your cover" looks empty until a manual page refresh.
      const receipt = await publicClient.waitForTransactionReceipt({ hash }).catch(() => null);
      if (receipt && receipt.status === "reverted") { setBuyError("purchase reverted on-chain"); return; }
      setConfirmDetail(`${selected.name} · ${peril} · ${fmtSTT(sumInsuredWei)} STT · ${duration}d\nPremium paid: ${fmtSTT(quote?.premiumWei ?? 0n)} STT`);
      setStep(4);
      onPolicyBought(); // refreshes "Your cover" in the background; the modal stays on the confirmation
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setBuyError(msg.slice(0, 120));
    } finally {
      setBuying(false);
    }
  }

  async function stepNext() {
    if (step === 1) { setStep(2); setPct(100); }
    else if (step === 2) { setStep(3); await buildQuote(); }
    else if (step === 3) { await doBuy(); }
    else if (step === 4) { onClose(); }
  }
  function stepBack() { if (step > 1 && step < 4) setStep((s) => s - 1); }
  function nextLabel() {
    if (step === 4) return "Done";
    if (step === 3) return buying ? "Buying…" : "Buy cover →";
    return "Next →";
  }

  const prevStep = useRef(step);
  useEffect(() => {
    if (step === 3 && prevStep.current !== 3) buildQuote();
    prevStep.current = step;
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const capLabel = `${fmtSTT(position)} STT`;

  return (
    <div id="buy-cover-overlay" className="open">
      <div className="buy-panel">
        <div className="buy-panel-header">
          <span className="buy-panel-title">Buy cover</span>
          <button className="buy-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="buy-steps">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className={`buy-step${step === n ? " active" : step > n ? " done" : ""}`}>
              {n === 1 ? "1 · Protocol" : n === 2 ? "2 · Amount" : n === 3 ? "3 · Quote" : "4 · Done"}
            </div>
          ))}
        </div>

        {/* Pane 1: which protocol (peril is fixed per target) */}
        <div className={`buy-pane${step === 1 ? " active" : ""}`}>
          <div>
            <div className="buy-field-label">Protocol to insure</div>
            <div className="buy-protocol-grid">
              {listings.map((l) => (
                <button
                  key={l.target}
                  className={`buy-proto-btn${l.target.toLowerCase() === targetAddr.toLowerCase() ? " selected" : ""}`}
                  onClick={() => setTargetAddr(l.target)}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "9px", color: "var(--text3)", lineHeight: 1.6 }}>
            Covers <strong style={{ color: "var(--text2)" }}>{peril}</strong> on {selected?.name}.
            You can insure up to your position ({capLabel}).
          </div>
        </div>

        {/* Pane 2: amount + duration */}
        <div className={`buy-pane${step === 2 ? " active" : ""}`}>
          <div className="buy-slider-wrap">
            <div className="buy-field-label">How much to cover — up to your position (<span>{capLabel}</span>)</div>
            <input type="range" className="buy-slider" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} />
            <div className="buy-slider-labels">
              <span>0</span>
              <span>{fmtSTT(sumInsuredWei)} STT ({pct}%)</span>
              <span>{capLabel}</span>
            </div>
          </div>
          <div>
            <div className="buy-field-label">For how long</div>
            <div className="buy-duration-row">
              {DURATION_OPTS.map((d) => (
                <button key={d} className={`buy-dur-btn${duration === d ? " selected" : ""}`} onClick={() => setDuration(d)}>{d}d</button>
              ))}
            </div>
          </div>
        </div>

        {/* Pane 3: AI quote (priced autonomously by the keeper; no manual re-price button) */}
        <div className={`buy-pane${step === 3 ? " active" : ""}`}>
          {quoteLoading ? (
            <div style={{ fontFamily: "var(--mono)", fontSize: "10px", color: "var(--text3)" }}>Getting a price…</div>
          ) : quote ? (
            <div className="quote-card">
              <div className="quote-row"><span className="quote-key">Protocol</span><span className="quote-val">{selected?.name}</span></div>
              <div className="quote-row"><span className="quote-key">Risk type</span><span className="quote-val">{peril}</span></div>
              <div className="quote-row"><span className="quote-key">AI risk score</span><span className="quote-val">{quote.riskLabel}</span></div>
              <div className="quote-row"><span className="quote-key">Annual rate</span><span className="quote-val">{quote.rateLabel}</span></div>
              <div className="quote-row"><span className="quote-key">Coverage</span><span className="quote-val">{fmtSTT(quote.coverageWei)} STT</span></div>
              <div className="quote-row"><span className="quote-key">Duration</span><span className="quote-val">{duration} days</span></div>
              <div className="quote-row" style={{ fontSize: "8px" }}><span className="quote-key">AI priced</span><span className="quote-val">{assessedAgo()} · 5 validators</span></div>
              <div className="quote-row premium-row"><span className="quote-key">Premium</span><span className="quote-val">{fmtSTT(quote.premiumWei)} STT</span></div>
            </div>
          ) : null}

          {buyError && <div style={{ fontFamily: "var(--mono)", fontSize: "9px", color: "var(--text2)" }}>Error: {buyError}</div>}
        </div>

        {/* Pane 4: confirmation */}
        <div className={`buy-pane${step === 4 ? " active" : ""}`}>
          <div className="buy-confirm-wrap">
            <div className="buy-confirm-title">You're covered</div>
            <div className="buy-confirm-detail" style={{ whiteSpace: "pre-line" }}>{confirmDetail}</div>
            {buyTxHash && (
              <div className="buy-confirm-tx">
                tx <a href={txUrl(buyTxHash)} target="_blank" rel="noreferrer">{shortAddr(buyTxHash)}</a>
              </div>
            )}
          </div>
        </div>

        <div className="buy-nav-row">
          <button className="buy-nav-back" style={{ visibility: step > 1 && step < 4 ? "visible" : "hidden" }} onClick={stepBack}>← Back</button>
          <button className="buy-nav-next" disabled={buying} onClick={stepNext}>{nextLabel()}</button>
        </div>
      </div>
    </div>
  );
}
