import { useCallback, useEffect, useRef, useState } from "react";
import { type Address, type Log } from "viem";
import { publicClient, ADDR } from "../chain/config";
import { aegisCoverAbi, oracleAbi } from "../chain/abi";
import { buildExploitEvidence, buildDepegEvidence } from "../chain/evidence";
import { fetchCommittee } from "../chain/committee";
import { useWallet } from "./useWallet";

export type GuardianPeril = "Exploit" | "Depeg";
export interface GuardianOpts {
  /** Live target to watch. Defaults to the exploit vault (back-compat). */
  target?: Address;
  /** Peril shaping the manual-fallback evidence. Defaults to "Exploit". */
  peril?: GuardianPeril;
}

export interface GuardianLive {
  phase: "idle" | "running" | "confirmed" | "rejected" | "failed";
  median: number;
  /** The real per-validator scores behind the verdict (from the oracle's ValidatorScores event). */
  scores: number[];
  questionId: `0x${string}` | null;
  requestId: bigint | null;
  startedAt: number | null;
  committee: Address[] | null;
  error: string | null;
  txHash: string | null;
  /** Owner-only manual fallback. The watcher fires requestCheck autonomously in production;
   *  this lets the owner nudge it on camera. Listeners are passive (always on), so a manual
   *  fire is observed by the same path as a watcher-fired one. */
  fireManual: (tvlBefore: bigint, tvlAfter: bigint) => Promise<void>;
}

type GuardianState = Omit<GuardianLive, "fireManual">;

const INITIAL: GuardianState = {
  phase: "idle",
  median: 0,
  scores: [],
  questionId: null,
  requestId: null,
  startedAt: null,
  committee: null,
  error: null,
  txHash: null,
};

// Look back a few blocks from mount so a check fired moments before the Guardian page
// opened (e.g. you exploited on the Dashboard, then navigated here) is still picked up.
const LOOKBACK_BLOCKS = 50n;

export function useGuardian(opts?: GuardianOpts): GuardianLive {
  const { walletClient, account } = useWallet();
  const target = opts?.target ?? ADDR.vault;
  const peril: GuardianPeril = opts?.peril ?? "Exploit";
  const [state, setState] = useState<GuardianState>(INITIAL);
  // requestId/questionId are captured by the CheckRequested listener; kept as live refs so the
  // verdict listener's committee fetch and the oracle-failure matcher see the latest values
  // regardless of who fired the check.
  const requestIdRef = useRef<bigint | null>(null);
  const questionIdRef = useRef<`0x${string}` | null>(null);

  // ─── Passive listeners: subscribe ON MOUNT, independent of who fires requestCheck. ───
  // This is what makes the Guardian reactive — when the off-chain watcher detects a drain
  // and calls requestCheck itself, CheckRequested appears and the pentagon lights up with no
  // user action. ADDR.cover/ADDR.vault are module constants, so this runs once per mount.
  useEffect(() => {
    let cancelled = false;
    const unwatchers: Array<() => void> = [];
    // Switching the watched target re-subscribes; reset so a prior target's verdict doesn't linger.
    setState(INITIAL);
    requestIdRef.current = null;
    questionIdRef.current = null;

    (async () => {
      let fromBlock: bigint;
      try {
        const bn = await publicClient.getBlockNumber();
        fromBlock = bn > LOOKBACK_BLOCKS ? bn - LOOKBACK_BLOCKS : 0n;
      } catch {
        fromBlock = 0n;
      }
      if (cancelled) return;

      // viem delivers async polling/filter errors to onError — NOT to the setup try/catch (which
      // only fires on a synchronous config throw). Without this, a subscription that silently dies
      // (RPC down, filter dropped) leaves the pentagon stuck on "monitoring" forever with no signal.
      const onSubError = (label: string) => (err: Error) => {
        const msg = (err as { shortMessage?: string }).shortMessage ?? err.message;
        setState((s) =>
          s.phase === "confirmed" || s.phase === "rejected"
            ? s
            : { ...s, phase: s.phase === "running" ? "failed" : s.phase, error: `${label}: ${msg}` },
        );
      };

      // CheckRequested → running. Whoever fired it (watcher or fireManual) lands here.
      try {
        unwatchers.push(
          publicClient.watchContractEvent({
            address: ADDR.cover,
            abi: aegisCoverAbi,
            eventName: "CheckRequested",
            args: { target },
            fromBlock,
            onError: onSubError("Check-request listener error"),
            onLogs: (logs) => {
              const lg = logs[logs.length - 1] as
                | Log<bigint, number, false, undefined, true, typeof aegisCoverAbi, "CheckRequested">
                | undefined;
              if (!lg) return;
              const reqId = lg.args.requestId ?? null;
              const qId = (lg.args.questionId ?? null) as `0x${string}` | null;
              requestIdRef.current = reqId;
              questionIdRef.current = qId;
              setState((s) =>
                // Don't clobber a resolved verdict if a stale CheckRequested replays.
                s.phase === "confirmed" || s.phase === "rejected"
                  ? s
                  : { ...s, phase: "running", startedAt: s.startedAt ?? Date.now(), error: null, requestId: reqId, questionId: qId },
              );
            },
          }),
        );
      } catch {
        /* setup throw only — runtime errors arrive via onError */
      }

      // VerdictReceived → confirmed/rejected (filtered to our target).
      try {
        unwatchers.push(
          publicClient.watchContractEvent({
            address: ADDR.cover,
            abi: aegisCoverAbi,
            eventName: "VerdictReceived",
            args: { target },
            fromBlock,
            onError: onSubError("Verdict listener error"),
            onLogs: async (logs) => {
              const lg = logs[logs.length - 1] as
                | Log<bigint, number, false, undefined, true, typeof aegisCoverAbi, "VerdictReceived">
                | undefined;
              if (!lg) return;
              const score = Number(lg.args.score ?? 0n);
              const confirmed = Boolean(lg.args.confirmed);
              const committee = await fetchCommittee(requestIdRef.current ?? 0n, fromBlock).catch(() => null);
              setState((s) => ({
                ...s,
                phase: confirmed ? "confirmed" : "rejected",
                median: score,
                questionId: (lg.args.questionId ?? s.questionId) as `0x${string}` | null,
                committee,
                error: null,
              }));
            },
          }),
        );
      } catch {
        /* setup throw only — runtime errors arrive via onError */
      }

      // ValidatorScores → the real per-validator votes (same tx as the verdict). Match requestId,
      // since the shared oracle emits this with no target field.
      try {
        unwatchers.push(
          publicClient.watchContractEvent({
            address: ADDR.oracle,
            abi: oracleAbi,
            eventName: "ValidatorScores",
            fromBlock,
            onError: onSubError("Validator-scores listener error"),
            onLogs: (logs) => {
              const lg = logs[logs.length - 1] as { args?: { requestId?: bigint; scores?: readonly bigint[] } } | undefined;
              if (!lg?.args) return;
              if (requestIdRef.current != null && lg.args.requestId !== requestIdRef.current) return;
              const scores = (lg.args.scores ?? []).map((s) => Number(s));
              if (scores.length > 0) setState((s) => ({ ...s, scores }));
            },
          }),
        );
      } catch {
        /* setup throw only — runtime errors arrive via onError */
      }

      // Oracle failure paths → "failed", but ONLY for the check we're actually mid-flight on.
      // VerdictFailed/VerdictDeliveryFailed are emitted by the SHARED oracle with NO target field,
      // so we must match requestId — else an unrelated failure (e.g. a risk-assessment under-
      // response on the same oracle, which deploy-demovault.sh fires) would falsely fail this
      // Guardian the moment it mounts.
      const failHandler = (label: string) => (logs: readonly { args?: { requestId?: bigint } }[]) => {
        const lg = logs[logs.length - 1];
        if (!lg) return;
        const failedReqId = lg.args?.requestId ?? null;
        setState((s) => {
          if (s.phase !== "running") return s; // only an in-flight check can fail
          if (requestIdRef.current == null || failedReqId !== requestIdRef.current) return s; // not ours
          return { ...s, phase: "failed", error: label };
        });
      };
      try {
        unwatchers.push(
          publicClient.watchContractEvent({
            address: ADDR.oracle,
            abi: oracleAbi,
            eventName: "VerdictFailed",
            fromBlock,
            onError: onSubError("Oracle-failure listener error"),
            onLogs: failHandler("Verdict failed — too few validator responses"),
          }),
          publicClient.watchContractEvent({
            address: ADDR.oracle,
            abi: oracleAbi,
            eventName: "VerdictDeliveryFailed",
            fromBlock,
            onError: onSubError("Oracle-failure listener error"),
            onLogs: failHandler("Verdict delivery failed"),
          }),
        );
      } catch {
        /* setup throw only — runtime errors arrive via onError */
      }
    })();

    return () => {
      cancelled = true;
      for (const u of unwatchers) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
    };
  }, [target]);

  // ─── Owner-only manual fallback: fire requestCheck ourselves. ───
  // Does NOT set up listeners (they're always on); the passive CheckRequested listener will
  // observe this fire just like a watcher-fired one. We optimistically flip to "running" so
  // the UI responds instantly, and surface a tx revert as "failed".
  const fireManual = useCallback(
    // `before`/`after` are peril-generic: exploit → TVL before/after; depeg → peg / current price.
    async (before: bigint, after: bigint) => {
      if (!walletClient || !account) {
        setState((s) => ({ ...s, error: "Connect wallet first" }));
        return;
      }
      requestIdRef.current = null;
      setState((s) => ({ ...s, phase: "running", startedAt: Date.now(), error: null, txHash: null }));

      const evidence = peril === "Depeg"
        ? buildDepegEvidence({
            target,
            observedAt: Math.floor(Date.now() / 1000),
            pegWei: before,
            priceWei: after,
            depegBandBps: 200,
          })
        : buildExploitEvidence({
            target,
            observedAt: Math.floor(Date.now() / 1000),
            tvlBefore: before,
            tvlAfter: after,
            windowSeconds: 38,
            web2Alerts: ["security-alert: anomalous outflow", "monitoring: TVL→0"],
          });

      try {
        const hash = await walletClient.writeContract({
          address: ADDR.cover,
          abi: aegisCoverAbi,
          functionName: "requestCheck",
          args: [target, evidence],
          account,
          chain: undefined,
          gas: 12_000_000n,
        });
        setState((s) => ({ ...s, txHash: hash }));
        const receipt = await publicClient.waitForTransactionReceipt({ hash }).catch(() => null);
        if (receipt && receipt.status === "reverted") {
          setState((s) => ({ ...s, phase: "failed", error: "requestCheck reverted" }));
        }
      } catch (e: any) {
        setState((s) => ({ ...s, phase: "failed", error: e?.shortMessage ?? "requestCheck failed" }));
      }
    },
    [walletClient, account, target, peril],
  );

  return { ...state, fireManual };
}
