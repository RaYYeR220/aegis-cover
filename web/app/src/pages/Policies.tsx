import { useCallback, useEffect, useState } from "react";
import { type Address } from "viem";
import { useWallet } from "../hooks/useWallet";
import { useChainReads, type Listing } from "../hooks/useChainReads";
import { publicClient, ADDR, txUrl } from "../chain/config";
import { aegisCoverAbi } from "../chain/abi";
import { fmtSTT, fmtDuration, shortAddr } from "../chain/format";
import { BuyCoverFlow } from "../components/BuyCoverFlow";

const mono = "var(--mono)";
const COVER_TYPE_NAMES = ["Exploit", "Depeg", "Bridge", "Slashing", "Oracle", "Governance"];
const STATUS_NAMES = ["Active", "Settled", "Expired"];

interface Policy {
  id: bigint;
  target: string;
  coverType: number;
  sumInsured: bigint;
  premiumPaid: bigint;
  duration: bigint;
  status: number;
}

// Enumerate every policy this wallet holds, across all targets.
async function fetchPolicies(account: Address): Promise<Policy[]> {
  try {
    const count = Number((await publicClient.readContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "policyCount" })) as bigint);
    const out: Policy[] = [];
    for (let i = 0; i < count && i < 200; i++) {
      const p = await publicClient.readContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "policies", args: [BigInt(i)] }).catch(() => null);
      if (!p) continue;
      const pol = p as readonly [Address, Address, number, bigint, bigint, bigint, bigint, bigint, number];
      if (pol[0].toLowerCase() === account.toLowerCase()) {
        out.push({ id: BigInt(i), target: pol[1].toLowerCase(), coverType: pol[2], sumInsured: pol[3], premiumPaid: pol[4], duration: pol[7], status: pol[8] });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      <span style={{ fontFamily: mono, fontSize: "8px", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text3)" }}>{label}</span>
      <span style={{ fontFamily: mono, fontSize: "12px", color: accent ? "var(--accent)" : "var(--text1)" }}>{value}</span>
    </div>
  );
}

function ConnectedPolicies({ account }: { account: Address }) {
  const { walletClient } = useWallet();
  const chain = useChainReads(account);
  const listings = chain.listings;

  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [buyPreselect, setBuyPreselect] = useState<Address | undefined>(undefined);
  const openBuy = (target?: Address) => { setBuyPreselect(target); setBuyOpen(true); };

  const load = useCallback(async () => { setPolicies(await fetchPolicies(account)); }, [account]);
  useEffect(() => { load(); }, [load, chain.targetSettled, chain.claimable]);

  const nameOf = (target: string) => listings.find((l) => l.target.toLowerCase() === target)?.name ?? shortAddr(target);
  const totalCover = (policies ?? []).filter((p) => p.status === 0).reduce((a, p) => a + p.sumInsured, 0n);
  const hasClaim = chain.claimable > 0n;
  // Show only active cover (and anything currently claimable) — hide spent/settled policies for clarity.
  const visiblePolicies = (policies ?? []).filter((p) => p.status === 0 || (p.status === 1 && hasClaim && chain.targetSettled));

  async function doClaim() {
    if (!walletClient) return;
    setClaiming(true); setClaimErr(null);
    try {
      const hash = await walletClient.writeContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "claim", account, chain: undefined, gas: 2_000_000n });
      const receipt = await publicClient.waitForTransactionReceipt({ hash }).catch(() => null);
      if (receipt && receipt.status === "reverted") { setClaimErr("claim reverted on-chain"); }
      else { setClaimTx(hash); await load(); }
    } catch (e: unknown) {
      const x = e as { shortMessage?: string; message?: string };
      setClaimErr(x?.shortMessage ?? x?.message ?? "claim failed");
    } finally { setClaiming(false); }
  }

  // Marketplace = active registry targets you can insure.
  const coverable = listings.filter((l) => l.active && !l.settled);

  return (
    <div className="page-wrap">
      {buyOpen && walletClient && coverable.length > 0 && (
        <BuyCoverFlow
          onClose={() => setBuyOpen(false)}
          onPolicyBought={() => { load(); }}
          account={account}
          walletClient={walletClient}
          listings={coverable}
          preselect={buyPreselect}
        />
      )}

      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "8px 0" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px", marginBottom: "20px" }}>
          <div style={{ display: "flex", gap: "28px", flexWrap: "wrap" }}>
            <Field label="Wallet" value={shortAddr(account)} />
            <Field label="Total cover" value={`${fmtSTT(totalCover)} STT`} />
            <Field label="Ready to claim" value={`${fmtSTT(chain.claimable)} STT`} accent={hasClaim} />
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {hasClaim && (
              <button
                onClick={doClaim}
                disabled={claiming}
                style={{ fontFamily: mono, fontSize: "11px", padding: "8px 16px", borderRadius: "4px", cursor: "pointer", border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)" }}
              >
                {claiming ? "Claiming…" : `Claim ${fmtSTT(chain.claimable)} STT`}
              </button>
            )}
          </div>
        </div>
        {(claimTx || claimErr) && (
          <div style={{ fontFamily: mono, fontSize: "9px", color: "var(--text3)", marginBottom: "16px" }}>
            {claimTx && !claimErr && <>claimed · tx <a href={txUrl(claimTx)} target="_blank" rel="noreferrer" style={{ color: "var(--text2)" }}>{shortAddr(claimTx)}</a></>}
            {claimErr && <span>{claimErr}</span>}
          </div>
        )}

        {/* Your cover */}
        <div style={{ fontFamily: mono, fontSize: "10px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text2)", marginBottom: "12px" }}>
          Your cover
        </div>
        {policies === null ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "12px", marginBottom: "28px" }}>
            {[0, 1].map((i) => (
              <div key={i} className="protocol-card skeleton" style={{ minHeight: "120px" }}>
                <div className="card-header"><span className="skel-bar" style={{ width: "45%", height: "13px" }} /><span className="skel-bar" style={{ width: "52px", height: "12px" }} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                  <span className="skel-bar" style={{ width: "80%", height: "11px" }} />
                  <span className="skel-bar" style={{ width: "80%", height: "11px" }} />
                  <span className="skel-bar" style={{ width: "80%", height: "11px" }} />
                </div>
                <span className="skel-bar" style={{ width: "40%", height: "9px" }} />
              </div>
            ))}
          </div>
        ) : visiblePolicies.length === 0 ? (
          <div style={{ fontFamily: mono, fontSize: "10px", color: "var(--text3)", padding: "12px 0" }}>No active cover — buy one below.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "12px", marginBottom: "28px" }}>
            {visiblePolicies.map((p) => {
              const settledClaimable = p.status === 1 && chain.claimable > 0n && chain.targetSettled;
              const statusLabel = settledClaimable ? "Loss confirmed · ready to claim" : STATUS_NAMES[p.status] ?? "Active";
              return (
                <div key={p.id.toString()} style={{ border: "1px solid var(--line)", borderRadius: "8px", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: mono, fontSize: "13px", color: "var(--text1)" }}>{nameOf(p.target)}</span>
                    <span style={{ fontFamily: mono, fontSize: "8px", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text3)", border: "1px solid var(--line2)", padding: "2px 6px" }}>
                      {COVER_TYPE_NAMES[p.coverType] ?? "Exploit"}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                    <Field label="Coverage" value={`${fmtSTT(p.sumInsured)} STT`} />
                    <Field label="Premium" value={`${fmtSTT(p.premiumPaid)} STT`} />
                    <Field label="Term" value={fmtDuration(p.duration)} />
                  </div>
                  <div style={{ fontFamily: mono, fontSize: "9px", color: settledClaimable ? "var(--accent)" : "var(--text3)", borderTop: "1px solid var(--line2)", paddingTop: "8px" }}>
                    {statusLabel}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Cover marketplace */}
        <div style={{ fontFamily: mono, fontSize: "10px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text2)", marginBottom: "12px" }}>
          Protocols you can insure
        </div>
        {!chain.loaded ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "12px" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="protocol-card skeleton" style={{ minHeight: "110px" }}>
                <div className="card-header"><span className="skel-bar" style={{ width: "45%", height: "13px" }} /><span className="skel-bar" style={{ width: "52px", height: "12px" }} /></div>
                <span className="skel-bar" style={{ width: "70%", height: "9px" }} />
                <span className="skel-bar" style={{ width: "38%", height: "26px" }} />
              </div>
            ))}
          </div>
        ) : coverable.length === 0 ? (
          <div style={{ fontFamily: mono, fontSize: "10px", color: "var(--text3)" }}>Nothing to insure right now.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "12px" }}>
            {coverable.map((l: Listing) => (
              <div key={l.target} style={{ border: "1px solid var(--line)", borderRadius: "8px", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: mono, fontSize: "13px", color: "var(--text1)" }}>{l.name}</span>
                  <span style={{ fontFamily: mono, fontSize: "8px", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text3)", border: "1px solid var(--line2)", padding: "2px 6px" }}>{l.peril}</span>
                </div>
                <div style={{ fontFamily: mono, fontSize: "9px", color: "var(--text3)", lineHeight: 1.5 }}>
                  AI risk: {l.riskAssessed ? `${l.riskScore}/100 → ${Number(l.rateBps) / 100}% premium` : "not yet rated"}
                </div>
                <button
                  onClick={() => openBuy(l.target)}
                  style={{ fontFamily: mono, fontSize: "10px", padding: "7px 14px", borderRadius: "4px", cursor: "pointer", border: "1px solid var(--line2)", background: "transparent", color: "var(--text1)", alignSelf: "flex-start" }}
                >
                  Buy {l.peril} cover →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Policies() {
  const { account, connect, connecting } = useWallet();
  if (!account) {
    return (
      <div className="page-wrap">
        <div className="policies-gate">
          <div className="policies-gate-title">Connect wallet to view your cover</div>
          <button className="policies-gate-btn" onClick={connect} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        </div>
      </div>
    );
  }
  return <ConnectedPolicies account={account} />;
}
