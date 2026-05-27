import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useChainReads } from "../hooks/useChainReads";
import { useWallet } from "../hooks/useWallet";
import { publicClient, ADDR } from "../chain/config";
import { aegisCoverAbi } from "../chain/abi";
import { fmtSTT, pctFromBps, riskBand } from "../chain/format";
import { PEG_WEI, DEMO_WALLET } from "../data/demo";
import { ProtocolCard } from "../components/ProtocolCard";
import { DemoExploitButton } from "../components/DemoExploitButton";
import { useVault, utilisationBps } from "../hooks/useVault";
import type { Listing } from "../hooks/useChainReads";

const mono = "var(--mono)";
const fmtPegPrice = (wei: bigint) => `$${Number(formatUnits(wei, 18)).toFixed(3)}`;

// How long ago the autonomous AI keeper last priced a target — surfaces the agent working on its own.
function pricedAgo(ts: bigint): string {
  if (!ts || ts === 0n) return "pending";
  const diff = Math.floor(Date.now() / 1000) - Number(ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function Tile({ label, value, unit, sub, accent }: { label: string; value: string; unit?: string; sub: string; accent?: boolean }) {
  return (
    <div className="dash-tile">
      <div className="tile-label">{label}</div>
      <div className={`tile-value${accent ? " claimable" : ""}`}>
        {value}{unit && <span style={{ fontSize: "13px", color: "var(--text3)", marginLeft: "4px" }}>{unit}</span>}
      </div>
      <div className="tile-sub">{sub}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="protocol-card skeleton" style={{ minHeight: "200px" }}>
      <div className="card-header"><span className="skel-bar" style={{ width: "40%", height: "13px" }} /><span className="skel-bar" style={{ width: "44px", height: "12px" }} /></div>
      <span className="skel-bar" style={{ width: "30%", height: "9px" }} />
      <span className="skel-bar" style={{ width: "55%", height: "24px" }} />
      <div className="card-chart" style={{ height: "90px" }}><span className="skel-bar" style={{ width: "100%", height: "100%" }} /></div>
      <span className="skel-bar" style={{ width: "70%", height: "10px" }} />
    </div>
  );
}

export function Dashboard() {
  const { account } = useWallet();
  const isOwner = !!account && account.toLowerCase() === DEMO_WALLET.toLowerCase();
  const chain = useChainReads(account);
  const vault = useVault(account); // read-only pool health (LP actions live on the Underwrite tab)

  const { claimable } = chain;
  const listings = chain.listings;
  const pegPrice = Number(formatUnits(PEG_WEI, 18)); // $1.00 reference for the depeg charts

  // The connected holder's policy on a given live target — for the "Your cover" line on its card.
  const [myPolicy, setMyPolicy] = useState<{ target: string; sumInsured: bigint; status: number } | null>(null);
  useEffect(() => {
    if (!account) { setMyPolicy(null); return; }
    let alive = true;
    (async () => {
      try {
        const count = Number((await publicClient.readContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "policyCount" })) as bigint);
        for (let i = 0; i < count && i < 80; i++) {
          const p = await publicClient.readContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "policies", args: [BigInt(i)] }).catch(() => null);
          if (!p) continue;
          const pol = p as readonly [string, string, number, bigint, bigint, bigint, bigint, bigint, number];
          if (pol[0].toLowerCase() === account.toLowerCase() && pol[8] === 0) {
            if (alive) setMyPolicy({ target: pol[1].toLowerCase(), sumInsured: pol[3], status: pol[8] });
            return;
          }
        }
        if (alive) setMyPolicy(null);
      } catch { if (alive) setMyPolicy(null); }
    })();
    return () => { alive = false; };
  }, [account, chain.targetSettled, claimable]);

  function yourCoverFor(l: Listing): string {
    if (!account) return "connect wallet";
    if (claimable > 0n && myPolicy && myPolicy.target === l.target.toLowerCase()) return `${fmtSTT(claimable)} STT · ready to claim`;
    if (myPolicy && myPolicy.target === l.target.toLowerCase()) return `${fmtSTT(myPolicy.sumInsured)} STT · covered`;
    return "Not insured";
  }

  function listingCard(l: Listing) {
    const status = l.settled
      ? l.peril === "Depeg" ? "Settled (depegged)"
        : l.peril === "Exploit" ? "Settled (exploited)"
        : "Settled (paid out)"
      : !l.isPrice && l.observed === 0n ? "Under attack" : "Healthy";
    return (
      <ProtocolCard
        key={l.target}
        name={l.name}
        live={true}
        coverType={l.peril}
        status={status}
        primaryMetric={l.isPrice ? fmtPegPrice(l.observed) : `${fmtSTT(l.observed)} STT`}
        metricLabel={l.isPrice ? "Price vs peg" : "TVL"}
        delta24h="—"
        riskLabel={l.riskAssessed ? `${riskBand(l.riskScore).band} · ${l.riskScore}/100` : "unrated"}
        rateLabel={l.riskAssessed ? pctFromBps(l.rateBps) : "—"}
        yourCover={yourCoverFor(l)}
        lastCheck={pricedAgo(l.riskAssessedAt)}
        spark={l.samples}
        peg={l.isPrice ? pegPrice : undefined}
      />
    );
  }

  // The live board = ACTIVE registry listings (deactivated/retired targets drop off). The exploit
  // target (the video's hero) is pinned first; the rest keep registry order.
  const activeListings = listings
    .filter((l) => l.active)
    .sort((a, b) =>
      (a.target.toLowerCase() === ADDR.vault.toLowerCase() ? -1 : 0) -
      (b.target.toLowerCase() === ADDR.vault.toLowerCase() ? -1 : 0),
    );
  const monitoredPerils = new Set(activeListings.map((l) => l.peril)).size;

  return (
    <div className="page active" id="page-dashboard">
      <div className="dash-layout">
        {/* Project-wide tracker tiles (live, not user-scoped) */}
        <div className="dash-tiles">
          <Tile label="Pool size" value={fmtSTT(vault.freeAssets)} unit="STT" sub={`${(utilisationBps(vault) / 100).toFixed(1)}% in use · earn →`} />
          <Tile label="Protocols covered" value={String(activeListings.length)} sub="monitored live on-chain" />
          <Tile label="Event types" value={String(monitoredPerils)} sub="exploit, depeg, bridge & more" />
          <Tile label="AI validators" value={String(chain.subcommitteeSize)} sub={`pay out when median ≥ ${chain.scoreThreshold}`} />
        </div>

        <div className="dash-scroll">
          {/* Owner-only demo triggers (hidden for everyone else; the only staged elements) */}
          {isOwner && (
            <div className="demo-bar">
              <span className="demo-bar-tag">DEMO</span>
              <DemoExploitButton />
              <span className="demo-bar-note">owner-only · stages the real on-chain exploit</span>
            </div>
          )}

          {/* The protocols Aegis covers — each a real on-chain target watched live; if the AI
              confirms a loss, cover pays out automatically. */}
          <section className="dash-section">
            <div className="dash-section-title">Protocols we cover</div>
            <div className="dash-section-note">
              Each is watched live. When an event looks real, 5 AI validators vote — if they agree, cover pays out automatically.
            </div>
            <div className="dash-grid">
              {!chain.loaded && activeListings.length === 0 ? (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              ) : activeListings.length > 0 ? (
                activeListings.map(listingCard)
              ) : (
                <div style={{ fontFamily: mono, fontSize: "10px", color: "var(--text3)", padding: "20px 0" }}>
                  No targets listed on this cover yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
