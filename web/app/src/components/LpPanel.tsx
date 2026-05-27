import { useState } from "react";
import { formatUnits, parseEther } from "viem";
import { useWallet } from "../hooks/useWallet";
import { useVault, navPerShare, utilisationBps } from "../hooks/useVault";
import { ADDR, txUrl, publicClient } from "../chain/config";
import { aegisCoverAbi } from "../chain/abi";
import { fmtSTT, shortAddr } from "../chain/format";

function Stat({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return (
    <div className="lp-stat">
      <span className="lp-stat-label">{label}</span>
      <span className={`lp-stat-value${accent ? " accent" : ""}`}>
        {value}{unit && <span className="lp-stat-unit">{unit}</span>}
      </span>
    </div>
  );
}

/**
 * LpPanel — the underwriter surface (supply side). LPs deposit STT for pool shares priced against
 * NAV, earn the premiums policyholders pay, and bear payouts when a verdict confirms. Shows pool free
 * capital, NAV/share, the utilisation lien (lockedCapacity/freeAssets) and the connected LP's value,
 * with side-by-side Supply / Withdraw cards (MAX/ALL chips + live share preview). Degrades to a muted
 * note against a cover without the vault.
 */
export function LpPanel() {
  const { account, walletClient, balance, connect } = useWallet();
  const v = useVault(account);
  const [depositStt, setDepositStt] = useState("");
  const [withdrawStt, setWithdrawStt] = useState("");
  const [busy, setBusy] = useState<"deposit" | "withdraw" | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const nav = navPerShare(v);
  const navLabel = v.totalShares === 0n ? "1.0000" : Number(formatUnits(nav, 18)).toFixed(4);
  const utilBps = utilisationBps(v);
  const utilPct = (utilBps / 100).toFixed(1);
  const sharePct = v.totalShares === 0n ? 0 : Number((v.yourShares * 10_000n) / v.totalShares) / 100;

  // Live "you'll receive" preview for the deposit input.
  function previewShares(stt: string): bigint {
    let wei: bigint;
    try { wei = parseEther(stt || "0"); } catch { return 0n; }
    if (wei <= 0n) return 0n;
    if (v.totalShares === 0n) return wei; // first deposit mints 1:1
    return (wei * v.totalShares) / (v.freeAssets === 0n ? wei : v.freeAssets);
  }
  const depositPreview = (() => {
    const s = previewShares(depositStt);
    if (s <= 0n) return null;
    const projectedTotal = v.totalShares + s;
    const pct = projectedTotal === 0n ? 0 : Number((s * 10_000n) / projectedTotal) / 100;
    return `≈ ${fmtSTT(s)} shares · ${pct.toFixed(1)}% of pool`;
  })();

  function sttToShares(stt: string): bigint {
    if (v.freeAssets === 0n) return 0n;
    let wei: bigint;
    try { wei = parseEther(stt || "0"); } catch { return 0n; }
    return (wei * v.totalShares) / v.freeAssets;
  }
  const withdrawPreview = (() => {
    const s = sttToShares(withdrawStt);
    if (s <= 0n) return null;
    const clamped = s > v.yourShares ? v.yourShares : s;
    return `≈ ${fmtSTT(clamped)} shares burned`;
  })();

  async function doDeposit() {
    if (!walletClient || !account) { connect(); return; }
    let value: bigint;
    try { value = parseEther(depositStt || "0"); } catch { setErr("bad amount"); return; }
    if (value <= 0n) { setErr("enter an amount"); return; }
    setBusy("deposit"); setErr(null); setTx(null);
    try {
      const hash = await walletClient.writeContract({
        address: ADDR.cover, abi: aegisCoverAbi, functionName: "deposit",
        args: [], account, chain: undefined, gas: 400_000n, value,
      });
      setTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash }).catch(() => null);
      if (receipt && receipt.status === "reverted") { setErr("deposit reverted on-chain"); setTx(null); }
      else { setDepositStt(""); }
      await v.refetch();
    } catch (e: unknown) {
      const x = e as { shortMessage?: string; message?: string };
      setErr(x?.shortMessage ?? x?.message ?? "deposit failed");
    } finally { setBusy(null); }
  }

  async function doWithdraw(all: boolean) {
    if (!walletClient || !account) { connect(); return; }
    const requested = all ? v.yourShares : sttToShares(withdrawStt);
    const shares = requested > v.yourShares ? v.yourShares : requested; // clamp: never burn more than held
    if (shares <= 0n) { setErr("nothing to withdraw"); return; }
    setBusy("withdraw"); setErr(null); setTx(null);
    try {
      const hash = await walletClient.writeContract({
        address: ADDR.cover, abi: aegisCoverAbi, functionName: "withdraw",
        args: [shares], account, chain: undefined, gas: 400_000n,
      });
      setTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash }).catch(() => null);
      if (receipt && receipt.status === "reverted") { setErr("withdraw reverted (under-collateralized?)"); setTx(null); }
      else { setWithdrawStt(""); }
      await v.refetch();
    } catch (e: unknown) {
      const x = e as { shortMessage?: string; message?: string };
      setErr(x?.shortMessage ?? x?.message ?? "withdraw failed");
    } finally { setBusy(null); }
  }

  // Wallet balance MAX, leaving a small gas buffer.
  function depositMax() {
    if (balance == null) { connect(); return; }
    const buffer = parseEther("0.02");
    const max = balance > buffer ? balance - buffer : 0n;
    setDepositStt(Number(formatUnits(max, 18)).toFixed(4));
  }
  // ALL fills the withdraw field with the full position value; doWithdraw clamps to yourShares.
  function withdrawAll() {
    if (v.yourValue <= 0n) return;
    setWithdrawStt(Number(formatUnits(v.yourValue, 18)).toFixed(4));
  }

  if (v.loaded && !v.supported) {
    return <div className="lp-unsupported">Pool initializes once the marketplace core is deployed.</div>;
  }

  const balLabel = balance == null ? "—" : `${fmtSTT(balance)} STT`;
  const hasPosition = v.yourShares > 0n;

  return (
    <div className="lp-panel">
      {/* Pool hero stats */}
      <div className="lp-stats">
        <Stat label="Pool size" value={fmtSTT(v.freeAssets)} unit="STT" />
        <Stat label="Share price" value={navLabel} />
        <Stat label="Reserved for claims" value={fmtSTT(v.lockedCapacity)} unit="STT" />
        <Stat label="Your deposit" value={fmtSTT(v.yourValue)} unit="STT" accent={hasPosition} />
      </div>

      {/* Utilisation bar */}
      <div className="lp-util">
        <div className="lp-util-head">
          <span>Pool in use</span>
          <span>{utilPct}% in use · {sharePct.toFixed(1)}% your share</span>
        </div>
        <div className="lp-util-track">
          <div className={`lp-util-fill${utilBps > 8000 ? " hot" : ""}`} style={{ width: `${Math.min(100, utilBps / 100)}%` }} />
        </div>
      </div>

      {/* Supply / Withdraw — two equal action cards */}
      <div className="lp-actions">
        <div className="lp-action">
          <div className="lp-action-head">
            <span className="lp-action-title">Supply</span>
            <span className="lp-action-avail">Wallet {balLabel}</span>
          </div>
          <div className="lp-input-box">
            <input placeholder="0.0" value={depositStt} onChange={(e) => setDepositStt(e.target.value)} inputMode="decimal" />
            <button className="lp-chip" disabled={busy !== null} onClick={depositMax}>MAX</button>
            <span className="lp-input-unit">STT</span>
          </div>
          <button className="lp-submit primary" disabled={busy !== null} onClick={doDeposit}>
            {busy === "deposit" ? "Depositing…" : account ? "Deposit" : "Connect wallet"}
          </button>
          <div className="lp-preview">{depositPreview ?? "earn premiums; payouts come from the pool"}</div>
        </div>

        <div className="lp-action">
          <div className="lp-action-head">
            <span className="lp-action-title">Withdraw</span>
            <span className="lp-action-avail">Position {fmtSTT(v.yourValue)} STT</span>
          </div>
          <div className="lp-input-box">
            <input placeholder="0.0" value={withdrawStt} onChange={(e) => setWithdrawStt(e.target.value)} inputMode="decimal" />
            <button className="lp-chip" disabled={busy !== null || !hasPosition} onClick={withdrawAll}>ALL</button>
            <span className="lp-input-unit">STT</span>
          </div>
          <button className="lp-submit" disabled={busy !== null || !hasPosition} onClick={() => doWithdraw(false)}>
            {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
          </button>
          <div className="lp-preview">{withdrawPreview ?? (hasPosition ? "withdraw anytime there's free capital" : "no deposit yet")}</div>
        </div>
      </div>

      {(tx || err) && (
        <div className="lp-tx">
          {tx && !err && <>tx <a href={txUrl(tx)} target="_blank" rel="noreferrer">{shortAddr(tx)}</a></>}
          {err && <span>{err}</span>}
        </div>
      )}
    </div>
  );
}
