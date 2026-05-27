import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { somniaShannon, publicClient } from "../chain/config";

interface WalletCtx {
  account: Address | null;
  balance: bigint | null;
  walletClient: WalletClient | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  connecting: boolean;
  error: string | null;
}
const Ctx = createContext<WalletCtx | null>(null);
const CHAIN_HEX = "0x" + somniaShannon.id.toString(16);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBalance = useCallback(async (a: Address) => {
    try { setBalance(await publicClient.getBalance({ address: a })); } catch { /* ignore */ }
  }, []);

  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) { setError("No injected wallet found (install MetaMask)."); return; }
    setConnecting(true); setError(null);
    try {
      await eth.request({ method: "eth_requestAccounts" });
      // ensure Somnia Shannon
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
      } catch (e: any) {
        if (e?.code === 4902) {
          await eth.request({ method: "wallet_addEthereumChain", params: [{
            chainId: CHAIN_HEX, chainName: somniaShannon.name,
            nativeCurrency: somniaShannon.nativeCurrency,
            rpcUrls: somniaShannon.rpcUrls.default.http,
            blockExplorerUrls: [somniaShannon.blockExplorers!.default.url],
          }] });
        } else throw e;
      }
      const wc = createWalletClient({ chain: somniaShannon, transport: custom(eth) });
      const [addr] = await wc.getAddresses();
      setWalletClient(wc); setAccount(addr); await refreshBalance(addr);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "connect failed");
    } finally { setConnecting(false); }
  }, [refreshBalance]);

  const disconnect = useCallback(() => { setAccount(null); setWalletClient(null); setBalance(null); }, []);

  useEffect(() => {
    const eth = (window as any).ethereum; if (!eth?.on) return;
    const onAcc = (accs: string[]) => { if (!accs.length) disconnect(); else { setAccount(accs[0] as Address); refreshBalance(accs[0] as Address); } };
    const onChain = () => window.location.reload();
    eth.on("accountsChanged", onAcc); eth.on("chainChanged", onChain);
    return () => { eth.removeListener?.("accountsChanged", onAcc); eth.removeListener?.("chainChanged", onChain); };
  }, [disconnect, refreshBalance]);

  return <Ctx.Provider value={{ account, balance, walletClient, connect, disconnect, connecting, error }}>{children}</Ctx.Provider>;
}
export function useWallet() { const c = useContext(Ctx); if (!c) throw new Error("useWallet outside provider"); return c; }
