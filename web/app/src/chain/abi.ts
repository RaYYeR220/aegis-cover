export const mockVaultAbi = [
  { type: "function", name: "tvl", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "recoverableOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposited", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDeposited", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "exploit", stateMutability: "nonpayable", inputs: [{ name: "attacker", type: "address" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "event", name: "Deposit", inputs: [{ name: "from", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "Exploited", inputs: [{ name: "attacker", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "Withdraw", inputs: [{ name: "to", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
] as const;

// DemoVault — the autonomous-product live target (real access-control vuln). Same recoverableOf
// signature as MockVault (so the generic adapter works), plus stake/unstake/rescueETH.
export const demoVaultAbi = [
  { type: "function", name: "tvl", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "recoverableOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "staked", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalStaked", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "stake", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "unstake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  // THE BUG: rescueETH ships without onlyOwner — anyone can sweep the whole pool to `to`.
  { type: "function", name: "rescueETH", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [] },
  { type: "event", name: "Staked", inputs: [{ name: "user", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "Unstaked", inputs: [{ name: "user", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "Exploited", inputs: [{ name: "attacker", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
] as const;

// DrainableVault — the reentrancy exploit target (real interaction-before-effect withdraw bug).
// Same recoverableOf signature as the other vaults so the generic adapter + loss-calc work.
export const drainableVaultAbi = [
  { type: "function", name: "tvl", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "recoverableOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDeposited", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "event", name: "Deposit", inputs: [{ name: "from", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "Withdraw", inputs: [{ name: "to", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
] as const;

// ReentrancyAttacker — attack() drains the vault in one tx; sweep() sends the loot to an EOA.
export const reentrancyAttackerAbi = [
  { type: "function", name: "attack", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "sweep", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [] },
  { type: "function", name: "chunk", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const adapterAbi = [
  { type: "function", name: "positionOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "vault", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const oracleAbi = [
  { type: "function", name: "scoreThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "subcommitteeSize", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minResponses", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pending", stateMutability: "view", inputs: [{ name: "requestId", type: "uint256" }], outputs: [
    { name: "consumer", type: "address" }, { name: "questionId", type: "bytes32" }, { name: "resolved", type: "bool" }
  ] },
  { type: "event", name: "VerdictRequested", inputs: [{ name: "requestId", type: "uint256", indexed: true }, { name: "consumer", type: "address", indexed: true }, { name: "questionId", type: "bytes32", indexed: true }] },
  { type: "event", name: "VerdictFinalized", inputs: [{ name: "requestId", type: "uint256", indexed: true }, { name: "questionId", type: "bytes32", indexed: true }, { name: "score", type: "uint256", indexed: false }, { name: "confirmed", type: "bool", indexed: false }] },
  { type: "event", name: "ValidatorScores", inputs: [{ name: "requestId", type: "uint256", indexed: true }, { name: "questionId", type: "bytes32", indexed: true }, { name: "scores", type: "uint256[]", indexed: false }] },
  { type: "event", name: "VerdictFailed", inputs: [{ name: "requestId", type: "uint256", indexed: true }, { name: "questionId", type: "bytes32", indexed: true }, { name: "responseCount", type: "uint256", indexed: false }] },
  { type: "event", name: "VerdictDeliveryFailed", inputs: [{ name: "requestId", type: "uint256", indexed: true }, { name: "questionId", type: "bytes32", indexed: true }] },
] as const;

export const aegisCoverAbi = [
  { type: "function", name: "riskScore", stateMutability: "view", inputs: [{ name: "target", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "riskAssessed", stateMutability: "view", inputs: [{ name: "target", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "riskAssessedAt", stateMutability: "view", inputs: [{ name: "target", type: "address" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "rateBps", stateMutability: "view", inputs: [{ name: "target", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "quotePremium", stateMutability: "view", inputs: [{ name: "target", type: "address" }, { name: "sumInsured", type: "uint256" }, { name: "duration", type: "uint64" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimable", stateMutability: "view", inputs: [{ name: "buyer", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "targetSettled", stateMutability: "view", inputs: [{ name: "target", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "policyCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "policies", stateMutability: "view", inputs: [{ name: "policyId", type: "uint256" }], outputs: [
    { name: "buyer", type: "address" },
    { name: "target", type: "address" },
    { name: "coverType", type: "uint8" },
    { name: "sumInsured", type: "uint256" },
    { name: "premiumPaid", type: "uint256" },
    { name: "positionAtPurchase", type: "uint256" },
    { name: "start", type: "uint64" },
    { name: "duration", type: "uint64" },
    { name: "status", type: "uint8" },
  ] },
  { type: "function", name: "policiesByTarget", stateMutability: "view", inputs: [{ name: "target", type: "address" }, { name: "index", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "questionKind", stateMutability: "view", inputs: [{ name: "questionId", type: "bytes32" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "questionTarget", stateMutability: "view", inputs: [{ name: "questionId", type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "COINSURANCE_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "YEAR", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cooldown", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastCheck", stateMutability: "view", inputs: [{ name: "target", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "buyPolicy", stateMutability: "payable", inputs: [{ name: "target", type: "address" }, { name: "coverType", type: "uint8" }, { name: "sumInsured", type: "uint256" }, { name: "duration", type: "uint64" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "requestCheck", stateMutability: "nonpayable", inputs: [{ name: "target", type: "address" }, { name: "evidence", type: "bytes" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "requestRiskAssessment", stateMutability: "nonpayable", inputs: [{ name: "target", type: "address" }, { name: "facts", type: "bytes" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "fundPool", stateMutability: "payable", inputs: [], outputs: [] },
  // ---- LP underwriting vault ----
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "s", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "shares", stateMutability: "view", inputs: [{ name: "lp", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "freeAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "previewValue", stateMutability: "view", inputs: [{ name: "lp", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lockedCapacity", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalClaimable", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  // ---- registry / catalog ----
  { type: "function", name: "listedTargetsCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "listedTargets", stateMutability: "view", inputs: [{ name: "index", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "listing", stateMutability: "view", inputs: [{ name: "target", type: "address" }], outputs: [
    { name: "adapter", type: "address" }, { name: "perilKey", type: "bytes32" }, { name: "active", type: "bool" }, { name: "name", type: "string" }
  ] },
  { type: "function", name: "registerTarget", stateMutability: "nonpayable", inputs: [{ name: "target", type: "address" }, { name: "a", type: "address" }, { name: "perilKey", type: "bytes32" }, { name: "name", type: "string" }], outputs: [] },
  { type: "function", name: "setTargetActive", stateMutability: "nonpayable", inputs: [{ name: "target", type: "address" }, { name: "active", type: "bool" }], outputs: [] },
  { type: "event", name: "CheckRequested", inputs: [{ name: "questionId", type: "bytes32", indexed: true }, { name: "target", type: "address", indexed: true }, { name: "requestId", type: "uint256", indexed: false }] },
  { type: "event", name: "VerdictReceived", inputs: [{ name: "questionId", type: "bytes32", indexed: true }, { name: "target", type: "address", indexed: true }, { name: "score", type: "uint256", indexed: false }, { name: "confirmed", type: "bool", indexed: false }] },
  { type: "event", name: "PolicyBought", inputs: [{ name: "policyId", type: "uint256", indexed: true }, { name: "buyer", type: "address", indexed: true }, { name: "target", type: "address", indexed: true }, { name: "coverType", type: "uint8", indexed: false }, { name: "sumInsured", type: "uint256", indexed: false }, { name: "premium", type: "uint256", indexed: false }] },
  { type: "event", name: "PolicySettled", inputs: [{ name: "policyId", type: "uint256", indexed: true }, { name: "buyer", type: "address", indexed: true }, { name: "loss", type: "uint256", indexed: false }, { name: "payout", type: "uint256", indexed: false }] },
  { type: "event", name: "Payout", inputs: [{ name: "target", type: "address", indexed: true }, { name: "totalCredited", type: "uint256", indexed: false }, { name: "policiesPaid", type: "uint256", indexed: false }] },
  { type: "event", name: "Claimed", inputs: [{ name: "buyer", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "RiskAssessed", inputs: [{ name: "target", type: "address", indexed: true }, { name: "score", type: "uint256", indexed: false }, { name: "rateBps", type: "uint256", indexed: false }] },
  { type: "event", name: "RiskAssessmentRequested", inputs: [{ name: "questionId", type: "bytes32", indexed: true }, { name: "target", type: "address", indexed: true }, { name: "requestId", type: "uint256", indexed: false }] },
  { type: "event", name: "Deposited", inputs: [{ name: "lp", type: "address", indexed: true }, { name: "assets", type: "uint256", indexed: false }, { name: "sharesMinted", type: "uint256", indexed: false }] },
  { type: "event", name: "Withdrawn", inputs: [{ name: "lp", type: "address", indexed: true }, { name: "assets", type: "uint256", indexed: false }, { name: "sharesBurned", type: "uint256", indexed: false }] },
  { type: "event", name: "TargetRegistered", inputs: [{ name: "target", type: "address", indexed: true }, { name: "adapter", type: "address", indexed: false }, { name: "perilKey", type: "bytes32", indexed: false }, { name: "name", type: "string", indexed: false }] },
] as const;

// MockStable — the depeg live target. price() (1e18 = peg) is owner-settable to stage a depeg;
// recoverableOf is price-scaled so the generic adapter values a holder's position at peg AND depeg.
export const mockStableAbi = [
  { type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "recoverableOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDeposited", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tvl", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  // DEMO ONLY: stage a depeg by setting the price below peg (onlyOwner).
  { type: "function", name: "setPrice", stateMutability: "nonpayable", inputs: [{ name: "_price", type: "uint256" }], outputs: [] },
  { type: "event", name: "Deposited", inputs: [{ name: "from", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "PriceSet", inputs: [{ name: "price", type: "uint256", indexed: false }] },
] as const;
