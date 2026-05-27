export function quotePremiumLocal(sumInsured: bigint, rateBps: bigint, durationSecs: bigint, bps: bigint, yearSecs: bigint): bigint {
  return (sumInsured * rateBps * durationSecs) / (bps * yearSecs);
}
