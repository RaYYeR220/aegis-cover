import { decodeAbiParameters, encodeAbiParameters, getAddress, type Address } from "viem";

// Decode an abi-encoded address[] (the subcommittee) from event data. Best-effort: the
// platform request event packs several fields; try to find a trailing address[] tail.
export function decodeCommittee(data: string): Address[] | null {
  if (!data || data === "0x") return null;
  try {
    const [arr] = decodeAbiParameters([{ type: "address[]" }], data as `0x${string}`);
    return arr.length ? (arr as Address[]) : null;
  } catch {
    return null;
  }
}

// Test helper — encode a pure address[] so decodeCommittee has a deterministic fixture.
export function encodeAddressArray(addrs: string[]): `0x${string}` {
  // Lowercase before getAddress so EIP-55 checksum is computed from the canonical lowercase form
  return encodeAbiParameters([{ type: "address[]" }], [addrs.map((a) => getAddress(a.toLowerCase())) as Address[]]);
}

// Best-effort live fetch: scan the platform's request logs for our requestId and decode the
// subcommittee. Returns null on any failure (caller falls back to demo validator labels).
const REQUEST_TOPIC0 = "0xb62339927ed9948fd837358a55f5b9a824f7b047043faece66965593ed726889";
export async function fetchCommittee(requestId: bigint, fromBlock: bigint): Promise<Address[] | null> {
  try {
    // Lazy import of config to avoid top-level ESM dependency issues in CJS require contexts
    const { publicClient, ADDR, AGENT_ID } = await import("./config");
    const logs = await publicClient.getLogs({
      address: ADDR.platform,
      fromBlock,
      toBlock: "latest",
      // requestId / agentId are likely indexed; we filter client-side to stay schema-agnostic
    } as Parameters<typeof publicClient.getLogs>[0]);
    for (const log of logs) {
      if (log.topics?.[0]?.toLowerCase() !== REQUEST_TOPIC0) continue;
      const matchesReq = log.topics.some((t) => t && BigInt(t) === requestId);
      const matchesAgent = log.topics.some((t) => t && BigInt(t) === AGENT_ID);
      if (!matchesReq && !matchesAgent) continue;
      const c = decodeCommittee(log.data);
      if (c && c.length >= 3) return c;
    }
  } catch { /* ignore — fall back */ }
  return null;
}
