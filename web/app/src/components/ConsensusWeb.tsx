import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ConsensusPhase = "idle" | "running" | "confirmed" | "rejected";

interface Props {
  phase: ConsensusPhase;
  median: number; // 0..100 (final or live partial)
  threshold: number; // 70
  validators: string[]; // 5 short labels (live committee or demo)
  rationales: { score: number; rationale: string }[];
  confirmedText: string; // e.g. "CONFIRMED · median 100 ≥ 70 · 1m 32s"
  onRun?: () => void; // fires the real check (Guardian wires this)
  runLabel?: string; // "Run consensus" | "↺ Replay" | "Computing…"
  busy?: boolean;
  // When provided, replaces the default run button — used by the reactive live Guardian to show
  // a "monitoring" indicator (and an owner-only manual-trigger fallback) instead of a primary CTA.
  controls?: ReactNode;
}

// ═══════════════════════════════════════════════════
// WEB GEOMETRY — symmetric regular pentagon (mockup 2659–2690)
// ═══════════════════════════════════════════════════
const CX = 260;
const CY = 260;
const ORBIT_R = 210;
const ARC_CIRC = 703.72; // 2π * 112

// Pure regular pentagon: 5 nodes, starting from top (-90°), evenly spaced at 72°
const nodeAngles = Array.from({ length: 5 }, (_, i) => -90 + i * 72);
function polarToCart(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
const nodePositions = nodeAngles.map((a) => polarToCart(CX, CY, ORBIT_R, a));

// Per-node label offset: pushed outward from center so labels clear the node rings + mesh lines.
function labelPos(p: { x: number; y: number }) {
  const dx = p.x - CX;
  const dy = p.y - CY;
  const len = Math.sqrt(dx * dx + dy * dy);
  return { x: p.x + (dx / len) * 30, y: p.y + (dy / len) * 30 };
}

// Threshold tick geometry: at threshold/100 of the ring, measured from -90°.
// Mockup hard-codes 162° for threshold=70 (252° from -90°). We compute it so it
// follows the `threshold` prop while matching the mockup at 70.
function thresholdAngle(threshold: number) {
  return -90 + (threshold / 100) * 360;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function ConsensusWeb(p: Props) {
  const { phase, median, threshold, validators, rationales, confirmedText, onRun, runLabel = "Run consensus", busy, controls } = p;

  // Refs to the imperative animation targets
  const ringRefs = useRef<(SVGCircleElement | null)[]>([]);
  const dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const labelRefs = useRef<(SVGTextElement | null)[]>([]);
  const connRefs = useRef<(SVGLineElement | null)[]>([]);
  const meshRefs = useRef<(SVGLineElement | null)[]>([]);
  const arcFillRef = useRef<SVGCircleElement | null>(null);
  const lockRingRef = useRef<SVGCircleElement | null>(null);
  const medianRef = useRef<SVGTextElement | null>(null);
  const confFillRef = useRef<HTMLDivElement | null>(null);
  const confirmedBelowRef = useRef<HTMLDivElement | null>(null);


  // Tooltip state (React-driven; mockup 2072–2077 + 3120–3146)
  const [tip, setTip] = useState<{ x: number; y: number; addr: string; score: number; rationale: string } | null>(null);

  // countUp — port of mockup easing (2774–2786)
  function countUp(el: SVGTextElement, target: number, duration: number) {
    return new Promise<void>((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        el.textContent = String(Math.round(eased * target));
        if (t < 1) requestAnimationFrame(tick);
        else {
          el.textContent = String(target);
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  // Render the final locked/confirmed state immediately (mockup loadEvent 2567–2648)
  function applyStaticState(confirmed: boolean) {
    const arcFill = arcFillRef.current;
    if (arcFill) {
      arcFill.style.transition = "none";
      arcFill.style.strokeDashoffset = String(ARC_CIRC - (median / 100) * ARC_CIRC);
    }
    if (confFillRef.current) confFillRef.current.style.width = median + "%";
    if (medianRef.current) medianRef.current.textContent = String(median);
    for (let i = 0; i < 5; i++) {
      const ring = ringRefs.current[i];
      const dot = dotRefs.current[i];
      const lbl = labelRefs.current[i];
      const conn = connRefs.current[i];
      const mesh = meshRefs.current[i];
      ring?.classList.remove("thinking");
      dot?.classList.remove("thinking");
      if (confirmed) {
        ring?.classList.add("locked");
        dot?.classList.add("locked");
        lbl?.classList.add("locked");
        conn?.classList.add("active");
        mesh?.classList.add("active");
      } else {
        ring?.classList.remove("locked");
        dot?.classList.remove("locked");
        lbl?.classList.remove("locked");
        conn?.classList.remove("active");
        mesh?.classList.remove("active");
      }
    }
    if (lockRingRef.current) lockRingRef.current.style.opacity = confirmed ? "1" : "0";
    const cb = confirmedBelowRef.current;
    if (cb) {
      cb.textContent = confirmedText;
      cb.classList.toggle("show", confirmed);
    }
  }

  // Reset to the clean "thinking" intro: clears any locked/settled visuals and shows "—".
  // Used both at the start of "running" and as the base for the resolution animation.
  function resetToThinkingBase() {
    for (let i = 0; i < 5; i++) {
      ringRefs.current[i]?.classList.remove("thinking", "locked");
      dotRefs.current[i]?.classList.remove("thinking", "locked");
      labelRefs.current[i]?.classList.remove("locked");
      connRefs.current[i]?.classList.remove("active");
      meshRefs.current[i]?.classList.remove("active");
    }
    const arcFill = arcFillRef.current;
    if (arcFill) {
      arcFill.style.transition = "none";
      arcFill.style.strokeDashoffset = String(ARC_CIRC);
    }
    if (lockRingRef.current) lockRingRef.current.style.opacity = "0";
    if (medianRef.current) medianRef.current.textContent = "—";
    const cb = confirmedBelowRef.current;
    if (cb) {
      cb.classList.remove("show");
      cb.textContent = confirmedText;
    }
    if (confFillRef.current) {
      confFillRef.current.style.transition = "none";
      confFillRef.current.style.width = "0%";
    }
  }

  // Tracks the phase from the previous render so we can tell a fresh settle (apply static
  // state instantly) from a settle that follows a "running" hold (animate the resolution).
  const prevPhaseRef = useRef<ConsensusPhase>(phase);

  // Animation effect, driven by `phase` transitions (mockup runConsensus 2788–2871),
  // SPLIT at the verdict boundary:
  //   • "running"            → play only the staggered "thinking" intro, then HOLD (no lock,
  //                            no arc, median "—") until the phase changes.
  //   • running → confirmed/ → play the resolution TAIL (stagger-lock → mesh → arc sweep →
  //     rejected               median count-up → lock-ring/confirmed reveal for confirmed).
  //   • settled (not from     → render the final static state immediately (demo first paint /
  //     running) / idle         event switch); no animation.
  // StrictMode-safe: the prior run is aborted in cleanup before any re-invoke, and every
  // branch is idempotent for a same-value re-run.
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    // ── "running": staggered thinking intro, then hold indefinitely ──
    if (phase === "running") {
      let aborted = false;
      (async () => {
        resetToThinkingBase();
        await delay(80);
        if (aborted) return;
        // Phase 1: staggered thinking + connectors (mockup 2822–2828). Then we STOP —
        // nodes keep pulsing via the .thinking class until the verdict phase lands.
        for (let i = 0; i < 5; i++) {
          await delay(200);
          if (aborted) return;
          ringRefs.current[i]?.classList.add("thinking");
          dotRefs.current[i]?.classList.add("thinking");
          connRefs.current[i]?.classList.add("active");
        }
        // HOLD: no lock, no arc sweep, no count-up, no confirmed text.
      })();
      return () => {
        aborted = true;
      };
    }

    // ── settled (confirmed/rejected) following a "running" hold: animate the resolution TAIL ──
    if ((phase === "confirmed" || phase === "rejected") && prevPhase === "running") {
      let aborted = false;
      const confirmed = phase === "confirmed";
      (async () => {
        // Phase 2: staggered lock + mesh (mockup 2832–2842). Nodes are mid-"thinking";
        // remove it as each locks.
        for (let i = 0; i < 5; i++) {
          await delay(280);
          if (aborted) return;
          const ring = ringRefs.current[i];
          const dot = dotRefs.current[i];
          ring?.classList.remove("thinking");
          ring?.classList.add("locked");
          dot?.classList.remove("thinking");
          dot?.classList.add("locked");
          labelRefs.current[i]?.classList.add("locked");
          meshRefs.current[i]?.classList.add("active");
        }

        await delay(300);
        if (aborted) return;

        // Phase 3: arc sweep + median count-up + confidence bar (mockup 2846–2851)
        const arcFill = arcFillRef.current;
        const targetOffset = ARC_CIRC - (median / 100) * ARC_CIRC;
        if (arcFill) {
          arcFill.style.transition = "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)";
          arcFill.style.strokeDashoffset = String(targetOffset);
        }
        if (confFillRef.current) {
          confFillRef.current.style.transition = "width 1.2s cubic-bezier(0.4,0,0.2,1)";
          confFillRef.current.style.width = median + "%";
        }
        if (medianRef.current) countUp(medianRef.current, median, 1100);

        await delay(800);
        if (aborted) return;
        await delay(550);
        if (aborted) return;

        // Phase 4: verdict reveal (mockup 2857–2865). Confirmed gets the lock-ring + accent;
        // rejected shows its "NOT CONFIRMED" text without the lock-ring/accent.
        const cb = confirmedBelowRef.current;
        if (cb) cb.textContent = confirmedText;
        if (confirmed) {
          if (lockRingRef.current) lockRingRef.current.style.opacity = "1";
          await delay(200);
          if (aborted) return;
        }
        cb?.classList.add("show");
      })();
      return () => {
        aborted = true;
      };
    }

    // ── idle / fresh settled load: render static end-state immediately (no animation) ──
    applyStaticState(phase === "confirmed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, median, confirmedText]);

  // Tooltip handlers (mockup 3120–3146)
  function showTip(idx: number, e: React.MouseEvent) {
    const r = rationales[idx];
    if (!r) return;
    setTip({ x: e.clientX, y: e.clientY, addr: validators[idx] ?? "", score: r.score, rationale: r.rationale });
  }
  function moveTip(e: React.MouseEvent) {
    setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t));
  }
  function hideTip() {
    setTip(null);
  }

  // Tooltip clamped position (mockup positionTooltip 3133–3142)
  const tipStyle = (() => {
    if (!tip) return undefined;
    const margin = 12;
    let x = tip.x + margin;
    let y = tip.y + margin;
    if (typeof window !== "undefined") {
      if (x + 260 > window.innerWidth) x = tip.x - 260 - margin;
      if (y + 90 > window.innerHeight) y = tip.y - 90 - margin;
    }
    return { left: x, top: y } as React.CSSProperties;
  })();

  const thAngle = thresholdAngle(threshold);

  return (
    <>
      <div className="web-area">
        <svg id="web-svg" viewBox="-30 -30 580 580" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="node-glow">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Connector lines (node → center) */}
          <g id="connectors">
            {nodePositions.map((pos, i) => (
              <line
                key={i}
                ref={(el) => {
                  connRefs.current[i] = el;
                }}
                className="connector"
                x1={CX}
                y1={CY}
                x2={pos.x.toFixed(2)}
                y2={pos.y.toFixed(2)}
              />
            ))}
          </g>

          {/* Node-to-node mesh */}
          <g id="mesh-connectors">
            {nodePositions.map((pos, i) => {
              const j = (i + 1) % 5;
              const next = nodePositions[j];
              return (
                <line
                  key={i}
                  ref={(el) => {
                    meshRefs.current[i] = el;
                  }}
                  className="connector"
                  x1={pos.x.toFixed(2)}
                  y1={pos.y.toFixed(2)}
                  x2={next.x.toFixed(2)}
                  y2={next.y.toFixed(2)}
                />
              );
            })}
          </g>

          {/* Arc ring group: centered at 260,260; radius 112 */}
          <g id="arc-group" transform="translate(260,260)">
            <circle className="arc-bg" cx="0" cy="0" r="112" />
            <circle
              className="arc-fill"
              id="arc-fill"
              ref={arcFillRef}
              cx="0"
              cy="0"
              r="112"
              strokeDasharray={ARC_CIRC}
              strokeDashoffset={0}
              transform="rotate(-90)"
            />

            {/* Threshold tick at threshold/100 of the ring */}
            <line id="threshold-tick" x1="104" y1="0" x2="122" y2="0" className="arc-threshold" transform={`rotate(${thAngle})`} />
            <g transform={`rotate(${thAngle})`}>
              <text
                x="133"
                y="0"
                fontFamily="IBM Plex Mono,monospace"
                fontSize="9"
                fill="#7ecfcf"
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${-thAngle},133,0)`}
              >
                {threshold}
              </text>
            </g>

            {/* Cardinal lock marks at top/bottom/left/right of outer lock ring */}
            <rect x="-2" y="-134" width="4" height="6" fill="var(--text2)" rx="0.5" />
            <rect x="-2" y="128" width="4" height="6" fill="var(--text2)" rx="0.5" />
            <rect x="128" y="-3" width="6" height="5" fill="var(--text2)" rx="0.5" />
            <rect x="-134" y="-3" width="6" height="5" fill="var(--text2)" rx="0.5" />

            {/* Dashed lock ring (confirmed state) */}
            <circle
              id="lock-ring"
              ref={lockRingRef}
              cx="0"
              cy="0"
              r="130"
              fill="none"
              stroke="rgba(255,255,255,0.14)"
              strokeWidth="1"
              strokeDasharray="2 5"
              opacity="0"
              style={{ transition: "opacity 0.8s" }}
            />

            {/* Center circle background */}
            <circle cx="0" cy="0" r="66" fill="var(--bg2)" stroke="var(--line)" strokeWidth="1" />

            {/* Median number — vertically centered */}
            <text
              className="center-median"
              id="center-median"
              ref={medianRef}
              x="0"
              y="0"
              fontFamily="IBM Plex Mono,monospace"
              fontSize="50"
              fontWeight="300"
              fill="var(--text)"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {median}
            </text>
            <text
              x="0"
              y="30"
              fontFamily="IBM Plex Mono,monospace"
              fontSize="7"
              fill="var(--text3)"
              textAnchor="middle"
              letterSpacing="0.16em"
              dominantBaseline="central"
            >
              MEDIAN
            </text>
          </g>

          {/* Nodes (on top) */}
          <g id="nodes">
            {nodePositions.map((pos, i) => {
              const lp = labelPos(pos);
              return (
                <g key={i} id={`node-group-${i}`}>
                  <circle
                    ref={(el) => {
                      ringRefs.current[i] = el;
                    }}
                    className="node-ring"
                    cx={pos.x.toFixed(2)}
                    cy={pos.y.toFixed(2)}
                    r="10"
                  />
                  <circle
                    ref={(el) => {
                      dotRefs.current[i] = el;
                    }}
                    className="node-dot"
                    cx={pos.x.toFixed(2)}
                    cy={pos.y.toFixed(2)}
                    r="3"
                  />
                  <text
                    ref={(el) => {
                      labelRefs.current[i] = el;
                    }}
                    className="node-label"
                    x={lp.x.toFixed(2)}
                    y={lp.y.toFixed(2)}
                  >
                    {validators[i]}
                  </text>
                  {/* Invisible hit area for hover/click */}
                  <circle
                    cx={pos.x.toFixed(2)}
                    cy={pos.y.toFixed(2)}
                    r="22"
                    style={{ fill: "transparent", cursor: "pointer" }}
                    onMouseEnter={(e) => showTip(i, e)}
                    onMouseMove={moveTip}
                    onMouseLeave={hideTip}
                    onClick={(e) => showTip(i, e)}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* CONFIRMED below pentagon */}
      <div className="confirmed-below">
        <div className="confirmed-below-text" id="confirmed-below-text" ref={confirmedBelowRef}>
          {confirmedText}
        </div>
      </div>

      {/* Slim confidence bar */}
      <div className="confidence-bar-wrap" id="confidence-bar-wrap">
        <div className="confidence-bar-track">
          <div className="confidence-bar-fill" id="confidence-bar-fill" ref={confFillRef} style={{ width: "100%" }} />
          <div className="confidence-bar-threshold" style={{ left: `${threshold}%` }} />
        </div>
        <div className="confidence-bar-labels">
          <span>0</span>
          <span className="tick-label" style={{ left: `${threshold}%` }}>
            {threshold}
          </span>
          <span>100</span>
        </div>
      </div>

      {/* Replay / Run button — or custom controls (reactive live Guardian) */}
      <div className="replay-area">
        {controls ?? (
          <button className="run-btn" id="run-btn" onClick={onRun} disabled={busy}>
            {runLabel}
          </button>
        )}
      </div>

      {/* Per-node tooltip — portaled to <body> so it escapes the #app zoom (a position:fixed element
          inside the zoomed shell would otherwise render offset from the cursor). */}
      {createPortal(
        <div className={`node-tooltip${tip ? " visible" : ""}`} id="node-tooltip" style={tipStyle}>
          <div className="node-tooltip-addr" id="tt-addr">{tip?.addr}</div>
          <div className="node-tooltip-score" id="tt-score">{tip ? `Score ${tip.score}` : ""}</div>
          <div className="node-tooltip-rationale" id="tt-rationale">{tip?.rationale}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
