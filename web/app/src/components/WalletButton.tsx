import { useWallet } from "../hooks/useWallet";
import { fmtSTT, shortAddr } from "../chain/format";

export function WalletButton() {
  const { account, balance, connect, disconnect, connecting } = useWallet();
  if (!account) return <button className="wallet-btn" onClick={connect} disabled={connecting}>{connecting ? "Connecting…" : "Connect Wallet"}</button>;
  return (
    <button className="wallet-btn connected" onClick={disconnect} title="Disconnect">
      {shortAddr(account)} {balance != null && <span className="wallet-bal">· {fmtSTT(balance)} STT</span>} ▾
    </button>
  );
}
