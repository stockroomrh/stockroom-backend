/**
 * Bindings for Pons's live `PonsLaunchLocker` contract on Robinhood Chain
 * mainnet. Address is read at runtime from the factory's `locker()` view
 * (see lib/server/trading/pons-client.ts) rather than hardcoded here, since
 * Pons could in principle repoint it — the factory is the source of truth.
 * ABI entries copied verbatim from the verified contract source on
 * Blockscout on 2026-07-27, same as pons-launch-factory.ts.
 *
 * `collectFees(token)` is pull-based, not auto-pushed: confirmed from the
 * verified source that the treasury (as both `launched.deployer` and the
 * `feeRedirects[token]` recipient set at launch) is directly authorized to
 * call it, and it transfers the treasury's share immediately on collection
 * — no separate escrow/withdraw step.
 */
export const PONS_LAUNCH_LOCKER_ABI = [
  {
    inputs: [{ internalType: "address", name: "token", type: "address" }],
    name: "collectFees",
    outputs: [
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "token", type: "address" }],
    name: "feeRedirects",
    outputs: [{ internalType: "address", name: "recipient", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "token", type: "address" },
      { indexed: true, internalType: "address", name: "caller", type: "address" },
      { indexed: false, internalType: "address", name: "token0", type: "address" },
      { indexed: false, internalType: "address", name: "token1", type: "address" },
      { indexed: false, internalType: "uint256", name: "recipientAmount0", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "recipientAmount1", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "protocolAmount0", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "protocolAmount1", type: "uint256" },
    ],
    name: "FeesClaimed",
    type: "event",
  },
] as const;
