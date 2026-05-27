import { formatUnits } from "viem";

export function fmtSTT(wei: bigint, dp = 2): string {
  const n = Number(formatUnits(wei, 18));
  const s = n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (dp === 2) return trimTrailing(s);
  return s;
}

// Strip a single trailing zero in the fractional part, but only when it is NOT "X.00"
// Examples: "0.10" -> "0.1"; "0.09" -> "0.09"; "0.00" -> "0.00"; "1,234.50" -> "1,234.5"
function trimTrailing(s: string): string {
  // Only strip if: has a decimal point, last char is "0", but the second-to-last decimal digit is NOT "0"
  const dotIdx = s.lastIndexOf(".");
  if (dotIdx === -1) return s;
  const frac = s.slice(dotIdx + 1); // e.g. "10", "09", "00"
  if (frac.length >= 2 && frac.endsWith("0") && frac[frac.length - 2] !== "0") {
    // e.g. "10" -> strip last zero -> "1"
    return s.slice(0, s.length - 1);
  }
  return s;
}

export function pctFromBps(bps: bigint): string { return `${Number(bps) / 100}%`; }

export function riskBand(score: bigint): { band: "Low" | "Medium" | "High"; rateBps: bigint } {
  if (score < 34n) return { band: "Low", rateBps: 300n };
  if (score < 67n) return { band: "Medium", rateBps: 600n };
  return { band: "High", rateBps: 1000n };
}

export function shortAddr(a: string): string { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

export function fmtDuration(secs: bigint): string { return `${Number(secs) / 86400}d`; }
