import { Sparkline } from "./Sparkline";

interface Props {
  name: string;
  live?: boolean;
  coverType?: string;
  status: string;
  primaryMetric: string;
  metricLabel: string;
  delta24h: string;
  riskLabel: string;
  rateLabel: string;
  yourCover?: string;
  lastCheck: string;
  spark?: number[];
  // Price-vs-peg chart when set (depeg targets); otherwise a TVL area chart.
  peg?: number;
  onClick?: () => void;
}

export function ProtocolCard(p: Props) {
  const statusClass =
    p.status.toLowerCase().includes("settled") || p.status.toLowerCase().includes("exploit")
      ? "card-status settled"
      : p.status.toLowerCase() === "elevated"
      ? "card-status elevated"
      : "card-status";

  const coverIsClaimable =
    p.yourCover != null && p.yourCover.toLowerCase().includes("claimable");

  // Split primaryMetric: if it ends with " STT", split the unit off for the card-primary-unit span
  const hasSTTUnit = p.primaryMetric.endsWith(" STT");
  const metricValue = hasSTTUnit ? p.primaryMetric.slice(0, -4) : p.primaryMetric;
  const metricUnit = hasSTTUnit ? "STT" : "";

  return (
    <div className="protocol-card" onClick={p.onClick}>
      <div className="card-header">
        <span className="card-name">{p.name}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {p.coverType && (
            <span style={{ fontFamily: "var(--mono)", fontSize: "8px", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text3)", border: "1px solid var(--line2)", padding: "1px 5px" }}>
              {p.coverType}
            </span>
          )}
          {p.live ? (
            <span className="card-tag" style={{ color: "var(--accent)", borderColor: "var(--accent)", display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: "pulse-live 2.4s ease-in-out infinite", flexShrink: 0 }} />
              LIVE
            </span>
          ) : (
            <span className="card-tag">demo</span>
          )}
        </div>
      </div>

      <div className={statusClass}>{p.status}</div>

      <div className="card-primary">
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text3)", marginBottom: "4px" }}>
            {p.metricLabel}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <span className="card-primary-value">{metricValue}</span>
            {metricUnit && <span className="card-primary-unit">{metricUnit}</span>}
          </div>
        </div>
        <span className="card-primary-delta">{p.delta24h}</span>
      </div>

      {/* Type-specific visual — price-vs-peg for depeg targets, TVL area otherwise (white line) */}
      <div className="card-chart">
        <Sparkline data={p.spark ?? []} height={90} peg={p.peg} />
      </div>

      <div className="card-metrics">
        <div className="card-metric">
          <div className="card-metric-label">AI risk → premium</div>
          <div className="card-metric-value">{p.riskLabel} → {p.rateLabel}</div>
        </div>
        <div className="card-metric">
          <div className="card-metric-label">AI priced</div>
          <div className="card-metric-value">{p.lastCheck}</div>
        </div>
      </div>

      <div className="card-cover-row">
        <span className="card-cover-label">Your cover</span>
        <span className={`card-cover-value${coverIsClaimable ? " claimable" : ""}`}>
          {p.yourCover ?? "—"}
        </span>
      </div>
    </div>
  );
}
