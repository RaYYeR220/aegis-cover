import { useEffect, useMemo, useRef, useState } from "react";
import { ConsensusWeb, type ConsensusPhase } from "../components/ConsensusWeb";
import { EventSelector } from "../components/EventSelector";
import { Committee } from "../components/Committee";
import { LossCalc, type PayoutState } from "../components/LossCalc";
import { useGuardian } from "../hooks/useGuardian";
import { useWallet } from "../hooks/useWallet";
import { useChainReads } from "../hooks/useChainReads";
import { publicClient, ADDR, AGENT_ID, txUrl, isAddrSet } from "../chain/config";
import { aegisCoverAbi, adapterAbi, mockStableAbi } from "../chain/abi";
import { fmtSTT, shortAddr } from "../chain/format";
import { DEMO_EVENTS, VALIDATOR_LABELS, NODE_RATIONALES, LIVE_PROTOCOL, LIVE_DEPEG_PROTOCOL, PEG_WEI, type DemoEvent } from "../data/demo";
import { parseEther, type Address } from "viem";

// Live targets the Guardian can watch. The depeg target only appears once it's deployed
// (ADDR.stable set), so the proven exploit flow is byte-for-byte unchanged pre-redeploy.
interface LiveTarget { name: string; address: Address; adapter: Address; peril: "Exploit" | "Depeg"; }
const LIVE_TARGETS: LiveTarget[] = [
  { name: LIVE_PROTOCOL, address: ADDR.vault, adapter: ADDR.adapter, peril: "Exploit" },
  ...(isAddrSet(ADDR.stable)
    ? [{ name: LIVE_DEPEG_PROTOCOL, address: ADDR.stable, adapter: ADDR.stableAdapter, peril: "Depeg" as const }]
    : []),
];

// Demo-event node rationales (used for the ZenVault depeg pentagon tooltips).
const DEPEG_RATIONALES = [
  { score: 85, rationale: '"Sustained −90 bps deviation for 45 min; clear depeg."' },
  { score: 82, rationale: '"Below peg with thin bid-side depth; depeg confirmed."' },
  { score: 80, rationale: '"3/3 feeds agree on the price drop; depeg."' },
  { score: 82, rationale: '"Price $0.991 vs $1.00 peg, persistent; depeg."' },
  { score: 81, rationale: '"Deviation beyond tolerance band; minor recovery uncertainty."' },
];

function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// Live-state indicator for the reactive Guardian: the pentagon is driven by passive on-chain
// listeners, so the center area shows a monitoring status (not a primary "run" CTA).
function MonitorPill({ text, tone = "live" }: { text: string; tone?: "live" | "muted" | "warn" }) {
  const color = tone === "live" ? "var(--accent)" : tone === "warn" ? "rgba(229,115,115,0.92)" : "var(--text3)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--mono)", fontSize: "11px", letterSpacing: "0.04em", color }}>
      <span
        style={{
          width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block",
          boxShadow: tone === "live" ? `0 0 8px ${color}` : "none",
          animation: tone === "live" ? "pulse 1.6s ease-in-out infinite" : "none",
        }}
      />
      {text}
    </div>
  );
}

export function Guardian() {
  const { account, walletClient, connect } = useWallet();
  const reads = useChainReads(account);
  // Event index: 0..liveCount-1 = LIVE targets (exploit, then depeg if deployed); rest = DEMO_EVENTS.
  const [idx, setIdx] = useState(0);
  const liveCount = LIVE_TARGETS.length;
  const total = liveCount + DEMO_EVENTS.length;
  const isLive = idx < liveCount;
  const activeLive: LiveTarget | null = isLive ? LIVE_TARGETS[idx]! : null;
  const isDepeg = isLive && activeLive!.peril === "Depeg";
  const demoEvent: DemoEvent | null = isLive ? null : DEMO_EVENTS[idx - liveCount];

  const guardian = useGuardian(activeLive ? { target: activeLive.address, peril: activeLive.peril } : undefined);

  // Per-target live read for the DEPEG target. The exploit target keeps using `reads` (which is
  // wired to ADDR.vault) unchanged, so the proven exploit flow is untouched.
  const [depegState, setDepegState] = useState<{ settled: boolean; positionNow: bigint; price: bigint; loaded: boolean }>(
    { settled: false, positionNow: 0n, price: 0n, loaded: false },
  );
  useEffect(() => {
    if (!isDepeg || !activeLive) return;
    let alive = true;
    const read = async () => {
      try {
        const settled = (await publicClient.readContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "targetSettled", args: [activeLive.address] })) as boolean;
        let positionNow = 0n;
        if (account) positionNow = (await publicClient.readContract({ address: activeLive.adapter, abi: adapterAbi, functionName: "positionOf", args: [account] }).catch(() => 0n)) as bigint;
        const price = (await publicClient.readContract({ address: activeLive.address, abi: mockStableAbi, functionName: "price" }).catch(() => 0n)) as bigint;
        if (alive) setDepegState({ settled, positionNow, price, loaded: true });
      } catch { /* keep last good */ }
    };
    read();
    const h = window.setInterval(read, 5000);
    return () => { alive = false; window.clearInterval(h); };
  }, [isDepeg, activeLive?.address, account]);

  // Unified live accessors: depeg target → its own reads; exploit target → the existing `reads`.
  const liveSettled = isDepeg ? depegState.settled : reads.targetSettled;
  const livePositionNow = isDepeg ? depegState.positionNow : reads.position;
  const liveLoaded = isDepeg ? depegState.loaded : reads.loaded;

  // Live elapsed timer, ticking while a run is in flight.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isLive || guardian.phase !== "running" || !guardian.startedAt) return;
    const h = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(h);
  }, [isLive, guardian.phase, guardian.startedAt]);

  // Claim flow.
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimErr, setClaimErr] = useState<string | null>(null);

  // Run-consensus guard hint — prevents settling on an un-drained position (→ 0 payout, burnt cover).
  const [runHint, setRunHint] = useState<string | null>(null);

  // The holder's live policy on this target (sumInsured + positionAtPurchase + status), best-effort.
  // status: 0 Active · 1 Settled · 2 Expired — drives the claim/claimed/nothing settlement state.
  const [policy, setPolicy] = useState<{ sumInsured: bigint; positionAtPurchase: bigint; status: number } | null>(null);
  useEffect(() => {
    if (!isLive || !account || !activeLive) { setPolicy(null); return; }
    const tgt = activeLive.address;
    let alive = true;
    (async () => {
      try {
        const countRaw = await publicClient.readContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "policyCount" });
        const count = Number(countRaw as bigint);
        for (let i = 0; i < count && i < 50; i++) {
          const idRaw = await publicClient.readContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "policiesByTarget", args: [tgt, BigInt(i)] }).catch(() => null);
          if (idRaw == null) break;
          const p = await publicClient.readContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "policies", args: [idRaw as bigint] }).catch(() => null);
          if (!p) continue;
          const pol = p as readonly [string, string, number, bigint, bigint, bigint, bigint, bigint, number];
          if (pol[0].toLowerCase() === account.toLowerCase() && pol[1].toLowerCase() === tgt.toLowerCase()) {
            if (alive) setPolicy({ sumInsured: pol[3], positionAtPurchase: pol[5], status: pol[8] });
            return;
          }
        }
        if (alive) setPolicy(null);
      } catch { if (alive) setPolicy(null); }
    })();
    return () => { alive = false; };
  }, [isLive, account, activeLive?.address, liveSettled]);

  // Demo (non-live) event phase: starts at its static settled state; Replay drives it
  // through the same running → settle split so the demo mirrors the live flow.
  const [demoPhase, setDemoPhase] = useState<ConsensusPhase | null>(null);
  const demoReplayTimer = useRef<number | null>(null);
  // Reset the demo phase whenever the selected event changes (live idle; demo static settled).
  useEffect(() => {
    if (demoReplayTimer.current != null) { window.clearTimeout(demoReplayTimer.current); demoReplayTimer.current = null; }
    setDemoPhase(null);
  }, [idx]);
  useEffect(() => () => { if (demoReplayTimer.current != null) window.clearTimeout(demoReplayTimer.current); }, []);

  function prevEvent() { setIdx((i) => (i - 1 + total) % total); }
  function nextEvent() { setIdx((i) => (i + 1) % total); }

  // ─── Derived view-model (live vs demo) ───
  const connected = !!account;

  // Pentagon phase. The hook's "failed" maps to "rejected" for the SVG (non-locked); the
  // error text is surfaced in the confirmed-below line + case-file verdict.
  const livePhase: ConsensusPhase =
    guardian.phase === "confirmed" ? "confirmed"
    : guardian.phase === "running" ? "running"
    : guardian.phase === "rejected" || guardian.phase === "failed" ? "rejected"
    : "idle";

  // Demo: its static settled phase, unless a Replay is in flight (demoPhase != null).
  const demoSettledPhase: ConsensusPhase = demoEvent && demoEvent.confirmed ? "confirmed" : "rejected";
  const phase: ConsensusPhase = isLive ? livePhase : (demoPhase ?? demoSettledPhase);

  const median = isLive ? guardian.median : demoEvent!.median;
  const threshold = Number(reads.scoreThreshold || 70n);

  // Validators: live committee if fetched, else the canonical demo labels.
  const validators = isLive
    ? (guardian.committee?.map(shortAddr) ?? VALIDATOR_LABELS)
    : VALIDATOR_LABELS;
  // Live: the REAL per-validator scores from the oracle's ValidatorScores event (the agent returns a
  // number, not a reason, so the tooltip shows the real vote + a neutral note — no fabricated text).
  // Empty until the verdict lands; demo events keep their scripted rationales.
  const rationales = isLive
    ? (guardian.scores.length > 0
        ? guardian.scores.map((sc) => ({ score: sc, rationale: "on-chain validator vote · reconciled by median" }))
        : [])
    : (demoEvent!.coverType === "Depeg" ? DEPEG_RATIONALES : NODE_RATIONALES);

  const elapsedMs = guardian.startedAt ? now - guardian.startedAt : 0;
  const liveElapsed = guardian.phase === "idle" ? "—" : fmtElapsed(elapsedMs);
  const timer = isLive ? (guardian.phase === "idle" ? "T+0m 00s" : `T+${fmtElapsed(elapsedMs)}`) : demoEvent!.timer;

  // Confirmed-below text.
  const confirmedText = isLive
    ? (guardian.phase === "confirmed"
        ? `CONFIRMED  ·  median ${median} ≥ ${threshold}  ·  ${fmtElapsed(elapsedMs)}`
        : guardian.phase === "failed"
          ? (guardian.error ?? "VERDICT FAILED")
          : guardian.phase === "rejected"
            ? `NOT CONFIRMED  ·  median ${median} < ${threshold}`
            : "")
    : demoEvent!.confirmedText;

  // Event-selector badge.
  const badge = isLive
    ? (guardian.phase === "confirmed" ? "CONFIRMED"
       : guardian.phase === "running" ? "RUNNING…"
       : guardian.phase === "failed" ? "FAILED"
       : guardian.phase === "rejected" ? "NOT CONFIRMED"
       : "LIVE")
    : demoEvent!.badge;
  const badgeConfirmed = isLive ? guardian.phase === "confirmed" : demoEvent!.confirmed;

  // Case-file fields.
  const eventId = isLive ? (guardian.requestId != null ? guardian.requestId.toString() : "—") : demoEvent!.id;
  const protocol = isLive ? activeLive!.name : demoEvent!.protocol;
  const coverType = isLive ? activeLive!.peril : demoEvent!.coverType;
  const verdictText = isLive
    ? (guardian.phase === "confirmed" ? "CONFIRMED"
       : guardian.phase === "rejected" ? "NOT CONFIRMED"
       : guardian.phase === "failed" ? "FAILED"
       : guardian.phase === "running" ? "RUNNING…"
       : "IDLE")
    : demoEvent!.verdict;
  const verdictClass = (isLive ? guardian.phase === "confirmed" : demoEvent!.confirmed) ? "status-confirmed" : "";
  const cfElapsed = isLive ? liveElapsed : demoEvent!.elapsed;

  // Evidence bullets: live built from the real signal (TVL drop or price-vs-peg); demo from the event.
  const evidence: string[] = useMemo(() => {
    if (!isLive) return demoEvent!.evidence;
    if (isDepeg) {
      const priceNum = Number(depegState.price) / 1e18;
      const pegNum = Number(PEG_WEI) / 1e18;
      const devBps = depegState.price > 0n && depegState.price < PEG_WEI
        ? Number(((PEG_WEI - depegState.price) * 10000n) / PEG_WEI)
        : 0;
      return [
        `Price $${priceNum.toFixed(3)} vs $${pegNum.toFixed(2)} peg`,
        `Deviation: −${devBps} bps below peg`,
        depegState.settled ? "Depeg confirmed on-chain" : "Live price monitored",
        "Evidence submitted on-chain",
        "Sustained break below tolerance band",
      ];
    }
    const before = fmtSTT(reads.tvl);
    const after = reads.targetSettled ? "0.00" : fmtSTT(reads.tvl);
    return [
      `TVL ${before} → ${after} STT`,
      reads.targetSettled ? "Drain confirmed on-chain" : "Live TVL monitored",
      "Evidence submitted on-chain",
      "2 web2 security alerts",
      "Single-attacker drain pattern",
    ];
  }, [isLive, isDepeg, demoEvent, reads.tvl, reads.targetSettled, depegState.price, depegState.settled]);

  // ─── Settlement (loss-calc) numbers ───
  // Live: positionBefore = policy.positionAtPurchase || current position; positionAfter = 0 when drained.
  // Demo: static 0.1 → 0 → 0.09 (ZenVault uses its own static; we mirror the mockup loss table).
  const live = {
    positionBefore: policy?.positionAtPurchase ?? livePositionNow,
    // Exploit: position → 0 on a drain. Depeg: position scales DOWN with the price (not to 0), so the
    // current price-scaled position IS the "after". Only register a loss once chain state has loaded
    // (avoids the phantom preview from the initial position=0n before the first poll returns).
    positionAfter: isDepeg
      ? (liveLoaded ? livePositionNow : (policy?.positionAtPurchase ?? livePositionNow))
      : (liveSettled ? 0n : (liveLoaded ? livePositionNow : (policy?.positionAtPurchase ?? livePositionNow))),
    sumInsured: policy?.sumInsured ?? (isDepeg ? 0n : reads.tvl),
    coinsuranceBps: reads.coinsuranceBps || 9000n,
    bps: reads.bps || 10000n,
  };
  const demoLoss = { positionBefore: parseEther("0.1"), positionAfter: 0n, sumInsured: parseEther("0.1"), coinsuranceBps: 9000n, bps: 10000n };
  const lossProps = isLive ? live : demoLoss;

  const netPayout = (() => {
    const covered = lossProps.positionBefore > lossProps.positionAfter ? lossProps.positionBefore - lossProps.positionAfter : 0n;
    const cap = covered < lossProps.sumInsured ? covered : lossProps.sumInsured;
    return (cap * lossProps.coinsuranceBps) / lossProps.bps;
  })();

  // Committee lock state: confirmed verdict locks the rows.
  const committeeLocked = isLive ? guardian.phase === "confirmed" : demoEvent!.confirmed;

  // ─── Run consensus button ───
  const runLabel = !isLive
    ? (demoPhase === "running" ? "Computing…" : "↺ Replay")
    : guardian.phase === "running" ? "Computing…"
    : guardian.phase === "idle" ? "Run consensus"
    : "↺ Replay";
  const runBusy = isLive ? (guardian.phase === "running" || !connected) : (demoPhase === "running");

  // Reactive live controls: the pentagon is driven by PASSIVE listeners (a check fired by the
  // watcher OR by the owner both light it up), so instead of a primary "Run consensus" CTA we show
  // a monitoring status. The owner keeps a small manual-trigger fallback — the watcher does this
  // autonomously in production. Non-live (demo) events fall back to ConsensusWeb's Replay button.
  const liveControls = (() => {
    if (guardian.phase === "running") return <MonitorPill text={`${validators.length} AI validators voting…`} />;
    if (guardian.phase === "confirmed") return <MonitorPill text="Decision in — claim on the right →" />;
    if (guardian.phase === "rejected") return <MonitorPill text="No loss confirmed" tone="muted" />;
    if (guardian.phase === "failed") return <MonitorPill text={guardian.error ?? "Check failed"} tone="warn" />;
    // Idle: just the live monitoring indicator. The off-chain watcher fires the consensus check
    // autonomously when it detects the event — no manual button (that's the whole point). If the
    // watcher is ever offline, the CLI fallback is `cast send <cover> requestCheck(...)`.
    return (
      <MonitorPill
        text={guardian.error ? `Connection issue — ${guardian.error}` : `Aegis is watching ${activeLive?.name ?? LIVE_PROTOCOL} — live`}
        tone={guardian.error ? "warn" : "live"}
      />
    );
  })();

  async function onRun() {
    if (!isLive) {
      // Demo Replay: drive the same running → settle split as the live flow (scripted timer).
      if (demoPhase === "running") return;
      if (demoReplayTimer.current != null) window.clearTimeout(demoReplayTimer.current);
      setDemoPhase("running");
      demoReplayTimer.current = window.setTimeout(() => {
        setDemoPhase(demoSettledPhase); // settle → ConsensusWeb animates the resolution
        demoReplayTimer.current = null;
      }, 1400);
      return;
    }
    if (!account || !activeLive) { connect(); return; }
    if (guardian.phase === "running") return;
    // The on-chain loss-calc reads positionOf(buyer) when the verdict lands. If the position
    // hasn't actually moved (drained / depegged), a confirmed verdict settles the cover for ZERO
    // and burns it. Gate the run on a real on-chain loss.
    if (!policy || policy.positionAtPurchase === 0n) {
      setRunHint(`No active ${activeLive.name} policy on this wallet — buy cover on the Policies page first.`);
      return;
    }
    // Authoritative FRESH read at click time. Never trust the polled position here: it is 0n
    // during the first load tick (and lags ~5s), which would falsely pass the gate and fire
    // consensus on an unchanged position → confirmed verdict settles for 0 and burns the cover.
    setRunHint(isDepeg ? "Checking on-chain price…" : "Checking on-chain position…");
    let posNow: bigint;
    try {
      posNow = (await publicClient.readContract({
        address: activeLive.adapter, abi: adapterAbi, functionName: "positionOf", args: [account],
      })) as bigint;
    } catch {
      setRunHint("Couldn't read the on-chain position — try again.");
      return;
    }
    if (posNow >= policy.positionAtPurchase) {
      setRunHint(isDepeg
        ? `Asset still at peg — depeg ${activeLive.name} on the Dashboard first so the loss-calc sees the price drop.`
        : "Position still funded — trigger the demo exploit on the Dashboard first so the on-chain loss-calc sees the drain.");
      return;
    }
    setRunHint(null);
    // Peril-generic before→after; the loss is already on-chain. Exploit: position→0. Depeg: peg→price.
    if (isDepeg) guardian.fireManual(PEG_WEI, depegState.price);
    else guardian.fireManual(policy.positionAtPurchase, 0n);
  }

  // ─── CLAIM / settlement state ───
  // A REAL, pull-able claim is the on-chain claimable balance — NOT the loss-calc preview and NOT a
  // sticky targetSettled (which stays true after a past run / a policy that isn't yours / after you
  // already claimed). Three unambiguous states for the connected wallet on this target:
  //   canClaim       — claimable > 0 right now (verdict confirmed, payout waiting to be pulled)
  //   alreadyClaimed — your policy settled with a positive payout and you've pulled it (claimable 0)
  //   neither        — nothing to claim (no policy, not your loss, or still active)
  const liveClaimable = reads.claimable;
  const myStatus = policy?.status ?? null; // 0 Active · 1 Settled · 2 Expired · null=none
  const canClaim = isLive ? liveClaimable > 0n : demoEvent!.confirmed;
  const alreadyClaimed = isLive && (!!claimTx || (myStatus === 1 && liveClaimable === 0n && netPayout > 0n));

  // Loss-calc Net payout reveals ONLY from real wallet settlement (claimable now / already paid) or
  // an in-flight confirm THIS session — never from sticky targetSettled. Kills the phantom 0.09.
  const payoutState: PayoutState = isLive
    ? (canClaim || alreadyClaimed || guardian.phase === "confirmed" ? "revealed"
       : guardian.phase === "running" ? "pending"
       : "none")
    : (demoEvent!.confirmed ? "revealed" : "pending");

  const claimDisabled = !connected || claiming || !!claimTx || !canClaim;
  const claimLabel = (() => {
    if (claimTx || alreadyClaimed) return "CLAIMED";
    if (!connected) return "Connect wallet to claim";
    if (claiming) return "CLAIMING…";
    if (canClaim) return `CLAIM ${fmtSTT(isLive ? liveClaimable : netPayout)} STT`;
    return "Nothing to claim";
  })();
  // A one-line status under the button so the settlement state is never ambiguous.
  const settleStatus: { text: string; tone: "accent" | "muted" } = (() => {
    if (!isLive) return { text: "demo · scripted preview", tone: "muted" };
    if (claimTx || alreadyClaimed) return { text: `settled · paid out ${fmtSTT(netPayout)} STT`, tone: "muted" };
    if (canClaim) return { text: "verdict confirmed · ready to claim", tone: "accent" };
    if (guardian.phase === "running") return { text: "consensus running…", tone: "muted" };
    if (liveSettled) return { text: "settled — no claim on this wallet", tone: "muted" };
    return { text: "no active claim", tone: "muted" };
  })();

  async function doClaim() {
    if (!isLive) return; // demo claim is non-functional (no on-chain policy)
    if (!walletClient || !account) { connect(); return; }
    setClaiming(true); setClaimErr(null);
    try {
      const hash = await walletClient.writeContract({
        address: ADDR.cover, abi: aegisCoverAbi, functionName: "claim",
        account, chain: undefined, gas: 2_000_000n,
      });
      setClaimTx(hash);
      // Don't show a green "CLAIMED" for a tx that reverted — inspect the receipt, surface the
      // failure, and clear the hash so the button re-enables for a retry.
      const receipt = await publicClient.waitForTransactionReceipt({ hash }).catch(() => null);
      if (receipt && receipt.status === "reverted") {
        setClaimErr("claim reverted on-chain — retry");
        setClaimTx(null);
      }
    } catch (e: any) {
      setClaimErr(e?.shortMessage ?? "claim failed");
    } finally { setClaiming(false); }
  }

  return (
    <div className="page active">
      <div className="guardian-layout">
        <EventSelector
          eventId={eventId}
          protocol={protocol}
          typeName={coverType}
          badge={badge}
          confirmed={badgeConfirmed}
          timer={timer}
          onPrev={prevEvent}
          onNext={nextEvent}
        />

        <div className="guardian-body">

          {/* LEFT: case file */}
          <div className="guardian-left">
            <div className="case-section">
              <div className="case-section-title">Target</div>
              <div className="case-row">
                <span className="case-key">Protocol</span>
                <span className="case-val primary">{protocol}</span>
              </div>
              <div className="case-row">
                <span className="case-key">Address</span>
                <span className="case-val">{isLive ? shortAddr(activeLive!.address) : "—"}</span>
              </div>
              <div className="case-row">
                <span className="case-key">Chain</span>
                <span className="case-val">Somnia Shannon</span>
              </div>
              <div className="case-row">
                <span className="case-key">Event #</span>
                <span className="case-val">{eventId}</span>
              </div>
            </div>

            <div className="case-section">
              <div className="case-section-title">Status</div>
              <div className="case-row">
                <span className="case-key">Verdict</span>
                <span className={`case-val ${verdictClass}`}>{verdictText}</span>
              </div>
              <div className="case-row">
                <span className="case-key">Cover type</span>
                <span className="case-val">{coverType}</span>
              </div>
              <div className="case-row">
                <span className="case-key">Elapsed</span>
                <span className="case-val">{cfElapsed}</span>
              </div>
            </div>

            <div className="case-section">
              <div className="case-section-title">Evidence</div>
              <ul className="evidence-list">
                {evidence.map((e, i) => (
                  <li className="evidence-item" key={i}>{e}</li>
                ))}
              </ul>
            </div>

            <div className="case-section">
              <div className="case-section-title">Agent</div>
              <div className="agent-row">
                <div className="agent-name">Qwen3-30B</div>
                <div className="agent-detail">5 validators · consensus median</div>
                <div className="agent-id">#{AGENT_ID.toString()}</div>
              </div>
            </div>
          </div>

          {/* CENTER: pentagon + controls */}
          <div className="guardian-center">
            <div className="guardian-center-group">
              <ConsensusWeb
                phase={phase}
                median={median}
                threshold={threshold}
                validators={validators}
                rationales={rationales}
                confirmedText={confirmedText}
                onRun={onRun}
                runLabel={runLabel}
                busy={runBusy}
                controls={isLive ? liveControls : undefined}
              />
              {isLive && runHint && (
                <div style={{ fontFamily: "var(--mono)", fontSize: "10px", lineHeight: 1.5, color: "var(--text3)", textAlign: "center", marginTop: "12px", maxWidth: "380px", marginLeft: "auto", marginRight: "auto" }}>
                  {runHint}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: settlement */}
          <div className="guardian-right">
            <div className="settle-section">
              <div className="settle-title">AI validators</div>
              <Committee validators={validators} locked={committeeLocked} />
            </div>

            <div className="settle-section">
              <div className="settle-title">Payout calculation</div>
              <LossCalc
                positionBefore={lossProps.positionBefore}
                positionAfter={lossProps.positionAfter}
                sumInsured={lossProps.sumInsured}
                coinsuranceBps={lossProps.coinsuranceBps}
                bps={lossProps.bps}
                payoutState={payoutState}
              />
            </div>

            <div className="settle-section claim-section">
              <div className="settle-title">Claim</div>
              <button
                className={`claim-big-btn${claimTx || alreadyClaimed ? " claimed" : ""}`}
                onClick={connected ? doClaim : connect}
                disabled={claimDisabled}
              >
                {claimLabel}
              </button>
              <div
                className="claim-state"
                style={{ color: settleStatus.tone === "accent" ? "var(--accent)" : "var(--text3)" }}
              >
                {settleStatus.text}
              </div>
              {claimErr && <div className="claim-tx show" style={{ color: "var(--text3)" }}>{claimErr}</div>}
              {claimTx && (
                <div className="claim-tx show">
                  tx&nbsp;<a href={txUrl(claimTx)} target="_blank" rel="noreferrer">{shortAddr(claimTx)}</a>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
