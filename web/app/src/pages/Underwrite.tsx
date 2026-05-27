import { useWallet } from "../hooks/useWallet";
import { useChainReads } from "../hooks/useChainReads";
import { LpPanel } from "../components/LpPanel";
import { riskBand, pctFromBps } from "../chain/format";

const mono = "var(--mono)";

/**
 * Underwrite — the SUPPLY side of the two-sided market. LPs deposit capital into the single cover
 * pool, earn the premiums policyholders pay, and bear payouts when an AI-consensus verdict confirms.
 * The pool backs every listed peril; the objective AI gate is what makes automated payouts — and so
 * decentralized underwriting — viable (vs per-claim governance voting).
 */
export function Underwrite() {
  const { account } = useWallet();
  const chain = useChainReads(account);
  // The pool backs the ACTIVE registry targets (retired/deactivated ones drop off).
  const listings = chain.listings.filter((l) => l.active);

  return (
    <div className="page-wrap">
      <div style={{ maxWidth: "920px", margin: "0 auto" }}>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontFamily: mono, fontSize: "15px", letterSpacing: "0.04em", color: "var(--text1)", marginBottom: "8px" }}>
            Earn by backing cover
          </div>
          <div style={{ fontFamily: mono, fontSize: "11px", lineHeight: 1.6, color: "var(--text3)", maxWidth: "640px" }}>
            Deposit STT into the shared cover pool. You earn the premiums buyers pay; if the AI confirms
            a real loss, the payout comes out of the pool. One pool backs every protocol below, and you
            can withdraw whenever there's free capital.
          </div>
        </div>

        {/* The pool surface: NAV, utilisation, your shares & value, deposit/withdraw. */}
        <LpPanel />

        {/* What this capital is exposed to — the registry, with each target's peril/risk/status. */}
        <div style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "16px 18px", background: "var(--bg2)", marginTop: "20px" }}>
          <div style={{ fontFamily: mono, fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text2)", marginBottom: "12px" }}>
            What this pool backs
          </div>
          {!chain.loaded ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 1.6fr 0.8fr", gap: "10px" }}>
                  <span className="skel-bar" style={{ width: "70%", height: "11px" }} />
                  <span className="skel-bar" style={{ width: "55%", height: "11px" }} />
                  <span className="skel-bar" style={{ width: "80%", height: "11px" }} />
                  <span className="skel-bar" style={{ width: "45%", height: "11px" }} />
                </div>
              ))}
            </div>
          ) : listings.length === 0 ? (
            <div style={{ fontFamily: mono, fontSize: "10px", color: "var(--text3)" }}>No listed targets yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 1.6fr 0.8fr", gap: "10px", fontFamily: mono, fontSize: "8px", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text3)" }}>
                <span>Protocol</span><span>Risk type</span><span>AI risk → premium</span><span>Status</span>
              </div>
              {listings.map((l) => (
                <div key={l.target} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 1.6fr 0.8fr", gap: "10px", fontFamily: mono, fontSize: "11px", color: "var(--text1)", paddingTop: "8px", borderTop: "1px solid var(--line2)" }}>
                  <span>{l.name}</span>
                  <span style={{ color: "var(--text2)" }}>{l.peril}</span>
                  <span style={{ color: "var(--text2)" }}>
                    {l.riskAssessed ? `${riskBand(l.riskScore).band} · ${l.riskScore}/100 → ${pctFromBps(l.rateBps)}` : "unrated"}
                  </span>
                  <span style={{ color: l.settled ? "rgba(229,115,115,0.9)" : "var(--text2)" }}>
                    {l.settled ? "settled" : l.active ? "active" : "paused"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
