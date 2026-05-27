import { useState } from "react";
import { parseEther } from "viem";
import { useWallet } from "../hooks/useWallet";
import { ADDR, txUrl, publicClient, isAddrSet } from "../chain/config";
import { mockStableAbi } from "../chain/abi";
import { DEMO_WALLET, LIVE_DEPEG_PROTOCOL } from "../data/demo";
import { shortAddr } from "../chain/format";

/**
 * DemoDepegButton — the depeg counterpart to DemoExploitButton. Owner-only; stages a depeg by
 * setting MockStable's price to $0.90 (10% below peg). The watcher (price-mode) then detects the
 * break, fires requestCheck autonomously, consensus confirms the depeg, and the cover settles the
 * price-scaled loss — the same real product path as the exploit loop, different peril.
 * Hidden until the depeg target is configured (ADDR.stable set post-redeploy).
 */
export function DemoDepegButton() {
  const { account, walletClient, connect } = useWallet();
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Owner-only, and only once the depeg target actually exists on-chain.
  if (!isAddrSet(ADDR.stable)) return null;
  if (!account || account.toLowerCase() !== DEMO_WALLET.toLowerCase()) return null;

  async function doDepeg() {
    if (!walletClient) { connect(); return; }
    if (!window.confirm(`DEMO: depeg ${LIVE_DEPEG_PROTOCOL} to $0.90 (10% below peg)? The watcher detects it and fires consensus.`)) return;
    setBusy(true); setErr(null); setTx(null);
    try {
      const hash = await walletClient.writeContract({
        address: ADDR.stable,
        abi: mockStableAbi,
        functionName: "setPrice",
        args: [parseEther("0.9")],
        account: account!,
        chain: undefined,
        gas: 200_000n,
      });
      setTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash }).catch(() => null);
      if (receipt && receipt.status === "reverted") { setErr("depeg reverted on-chain"); setTx(null); }
    } catch (e: unknown) {
      const x = e as { shortMessage?: string; message?: string };
      setErr(x?.shortMessage ?? x?.message ?? "depeg failed");
    } finally { setBusy(false); }
  }

  return (
    <>
      <button
        className="demo-mini-btn depeg"
        onClick={doDepeg}
        disabled={busy}
        title={`Depegs ${LIVE_DEPEG_PROTOCOL} to $0.90 (10% below peg). The watcher detects the break and fires consensus — the rest of the flow is the real product.`}
      >
        {busy ? "Staging…" : `📉 Depeg ${LIVE_DEPEG_PROTOCOL} → $0.90`}
      </button>
      {tx && !err && (
        <span className="demo-mini-tx">tx <a href={txUrl(tx)} target="_blank" rel="noreferrer">{shortAddr(tx)}</a></span>
      )}
      {err && <span className="demo-mini-tx">{err}</span>}
    </>
  );
}
