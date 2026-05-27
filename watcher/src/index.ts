import { loadConfig } from "./config.js";
import { makeChainDeps } from "./chain.js";
import { startWatcher } from "./loop.js";

// Load watcher/.env into process.env if present (native, Node >=20.12 — no external dep).
// Lets `npm run dev` work without manually exporting vars; harmless if the file is absent or
// the environment is already populated (e.g. CI). Must run before main() reads process.env.
try {
  (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
} catch (e) {
  // An absent .env is fine (rely on ambient env, e.g. CI). A MALFORMED .env, however, must be
  // visible — otherwise it surfaces later as a confusing "Missing required env" instead of the cause.
  if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
    console.warn(`[watcher] .env present but could not be loaded: ${(e as Error).message} — using ambient environment`);
  }
}


function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const cfg = loadConfig(process.env, { dryRun });

  console.log(`[watcher] starting${dryRun ? " (dry-run)" : ""} — ${cfg.targets.length} target(s), poll ${cfg.pollIntervalMs}ms`);
  console.log(`[watcher] cover=${cfg.coverAddress} rpc=${cfg.rpcUrl}`);

  const deps = makeChainDeps(cfg);
  const running = startWatcher(cfg, deps);

  const shutdown = () => {
    console.log("\n[watcher] stopping…");
    running.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
