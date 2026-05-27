import { createPublicClient, defineChain, http, type Address } from "viem";

const env = (import.meta as any).env ?? {};

export const somniaShannon = defineChain({
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [env.VITE_RPC_URL ?? "https://api.infra.testnet.somnia.network"] } },
  blockExplorers: { default: { name: "Shannon", url: "https://shannon-explorer.somnia.network" } },
  testnet: true,
});

export const ADDR = {
  // Extensible marketplace core (deployed 2026-05-25; prompts-in-storage oracle + registry + LP vault).
  oracle: (env.VITE_ORACLE ?? "0xda57E8B08aAbC6eb97Ef781b6D56E9192EAEdC26") as Address,
  cover: (env.VITE_COVER ?? "0x47824E585F7eCd4dD6574800625570ba9642FaB2") as Address,
  // Exploit target = DrainableVault (real REENTRANCY bug — the canonical The-DAO class). An attacker
  // contract drains the whole pool in one tx. deploy-board.sh mints a FRESH, healthy vault + attacker
  // (settled targets are sticky) — re-arm + repoint here (or VITE_VAULT/_ADAPTER/_ATTACKER) per
  // recording. Below = the live board set (armed, healthy; one of two Exploit cards on the dashboard).
  vault: (env.VITE_VAULT ?? "0x48e86b27161dD1BF48050F6B51fC19BE545d43B8") as Address,
  adapter: (env.VITE_ADAPTER ?? "0x5cb92Aacab05754d387F69F5fd5a03DbBcA29C79") as Address,
  // The ReentrancyAttacker contract — its attack() drains the vault. The exploit trigger calls this.
  attacker: (env.VITE_ATTACKER ?? "0x6D230CDB67a50641ed74D885cC7b9d817EBd2094") as Address,
  // Depeg live target (MockStable, price-scaled recoverableOf) + its generic adapter. Now set →
  // the depeg surfaces (registry card, Guardian 2nd live event, buy option, DemoDepegButton) light
  // up. Re-arm via deploy-board.sh / deploy-mockstable.sh before recording (settled is sticky).
  stable: (env.VITE_STABLE ?? "0x67A28eabb4E64BFe4EE35e5cb18B25E0431B400E") as Address,
  stableAdapter: (env.VITE_STABLE_ADAPTER ?? "0x1223221fd51aFbc4173ac1e3C3979D0EAC629Bc2") as Address,
  platform: "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as Address,
} as const;

const ZERO = "0x0000000000000000000000000000000000000000";
/** True once an optional address (e.g. the depeg target) has actually been deployed/configured. */
export const isAddrSet = (a: Address): boolean => a.toLowerCase() !== ZERO;

export const AGENT_ID = 12847293847561029384n;
export const EXPLORER = "https://shannon-explorer.somnia.network";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;

export const publicClient = createPublicClient({ chain: somniaShannon, transport: http() });
