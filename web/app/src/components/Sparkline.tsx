interface Props {
  data: number[];
  height?: number;
  accent?: boolean;
  // When set, render a price-vs-peg chart: a fixed y-window around `peg`, a dashed peg reference
  // line, and the price area below it — so a depegged asset visibly sits under the peg.
  peg?: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function Sparkline({ data, height = 48, accent = false, peg }: Props) {
  const w = 100, h = height;
  if (data.length < 1) return <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" />;
  // White line by default (matches the mockup); accent only when explicitly requested.
  const col = accent ? "var(--accent)" : "rgba(232,233,234,0.55)";
  const series = data.length === 1 ? [data[0], data[0]] : data; // single sample → flat line

  // ── Price-vs-peg mode ──
  if (peg != null && peg > 0) {
    const top = peg * 1.04, bot = peg * 0.8, range = top - bot || 1;
    const y = (val: number) => h - ((clamp(val, bot, top) - bot) / range) * (h - 4) - 2;
    const pts = series.map((v, i) => [(i / (series.length - 1)) * w, y(v)] as const);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const area = `${line} L${w},${h} L0,${h} Z`;
    const pegY = y(peg).toFixed(1);
    return (
      <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <path d={area} fill={col} opacity={0.08} />
        <path d={line} fill="none" stroke={col} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {/* peg reference line — a depegged price sits visibly below it */}
        <line x1="0" y1={pegY} x2={w} y2={pegY} stroke="var(--accent)" strokeWidth={1}
          strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity={0.5} />
      </svg>
    );
  }

  // ── Auto-scaled value (TVL) mode ──
  const min = Math.min(...series), max = Math.max(...series);
  const flat = max === min; // steady baseline (e.g. an un-moved TVL) → draw a flat mid-line
  const span = max - min || 1;
  const pts = series.map((v, i) => [
    (i / (series.length - 1)) * w,
    flat ? h / 2 : h - ((v - min) / span) * (h - 4) - 2,
  ] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={area} fill={col} opacity={0.08} />
      <path d={line} fill="none" stroke={col} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
