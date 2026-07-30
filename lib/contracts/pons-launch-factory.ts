/**
 * Bindings for Pons's live `PonsLaunchFactory` contract on Robinhood Chain.
 * ABI entries below are the exact subset we call/read, copied verbatim from
 * the verified contract source on Blockscout
 * (GET /api/v2/smart-contracts/{address} against robinhoodchain.blockscout.com)
 * on 2026-07-27 — not hand-transcribed from docs, to avoid the field-name
 * guessing risk that bit the 0x integration in Stage 5.
 *
 * MAINNET ONLY. Pons has no testnet deployment — this address is only valid
 * on Robinhood Chain mainnet (chain id 4663, ROBINHOOD_MAINNET_ID in
 * lib/chain-config.ts). Never call this on testnet.
 */
export const PONS_LAUNCH_FACTORY_ADDRESS = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB" as const;

export const PONS_LAUNCH_FACTORY_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "token", type: "address" },
      { indexed: true, internalType: "address", name: "deployer", type: "address" },
      { indexed: true, internalType: "address", name: "dexFactory", type: "address" },
      { indexed: false, internalType: "address", name: "pairToken", type: "address" },
      { indexed: false, internalType: "uint256", name: "dexId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "launchConfigId", type: "uint256" },
    ],
    name: "TokenDeployed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "token", type: "address" },
      { indexed: true, internalType: "address", name: "deployer", type: "address" },
      { indexed: true, internalType: "address", name: "dexFactory", type: "address" },
      { indexed: false, internalType: "address", name: "pairToken", type: "address" },
      { indexed: false, internalType: "address", name: "pool", type: "address" },
      { indexed: false, internalType: "uint256", name: "dexId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "launchConfigId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "positionId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "restrictionsEndBlock", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "initialBuyAmount", type: "uint256" },
    ],
    name: "TokenLaunched",
    type: "event",
  },
  { inputs: [], name: "dexConfigCount", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  {
    inputs: [{ internalType: "uint256", name: "id", type: "uint256" }],
    name: "getDexConfig",
    outputs: [
      {
        components: [
          { internalType: "string", name: "name", type: "string" },
          { internalType: "address", name: "factory", type: "address" },
          { internalType: "address", name: "positionManager", type: "address" },
          { internalType: "address", name: "swapRouter", type: "address" },
          { internalType: "uint24", name: "poolFee", type: "uint24" },
          { internalType: "int24", name: "tickSpacing", type: "int24" },
          { internalType: "bool", name: "enabled", type: "bool" },
        ],
        internalType: "struct PonsLaunchFactory.DexConfig",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "id", type: "uint256" }],
    name: "getLaunchConfig",
    outputs: [
      {
        components: [
          { internalType: "address", name: "pairToken", type: "address" },
          { internalType: "uint256", name: "graduationThreshold", type: "uint256" },
          { internalType: "int24", name: "initialTick", type: "int24" },
          { internalType: "uint256", name: "supply", type: "uint256" },
          { internalType: "uint16", name: "maxWalletBps", type: "uint16" },
          { internalType: "uint16", name: "maxTxBps", type: "uint16" },
          { internalType: "uint32", name: "restrictionBlocks", type: "uint32" },
          { internalType: "uint24", name: "reservedFee", type: "uint24" },
          { internalType: "bool", name: "enabled", type: "bool" },
          { internalType: "bool", name: "routerRequiresDeadline", type: "bool" },
        ],
        internalType: "struct PonsLaunchFactory.LaunchConfig",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [], name: "launchConfigCount", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "launchEnabled", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "launchFee", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  {
    inputs: [
      {
        components: [
          { internalType: "string", name: "name", type: "string" },
          { internalType: "string", name: "symbol", type: "string" },
          { internalType: "string", name: "logo", type: "string" },
          { internalType: "string", name: "description", type: "string" },
          {
            components: [
              { internalType: "string", name: "twitter", type: "string" },
              { internalType: "string", name: "telegram", type: "string" },
              { internalType: "string", name: "discord", type: "string" },
              { internalType: "string", name: "website", type: "string" },
              { internalType: "string", name: "farcaster", type: "string" },
            ],
            internalType: "struct PonsLaunchFactory.Socials",
            name: "socials",
            type: "tuple",
          },
          { internalType: "address", name: "feeWallet", type: "address" },
        ],
        internalType: "struct PonsLaunchFactory.TokenParams",
        name: "params",
        type: "tuple",
      },
      { internalType: "uint256", name: "launchConfigId", type: "uint256" },
      { internalType: "uint256", name: "dexId", type: "uint256" },
      { internalType: "bytes32", name: "salt", type: "bytes32" },
    ],
    name: "launchToken",
    outputs: [{ internalType: "address", name: "token", type: "address" }],
    stateMutability: "payable",
    type: "function",
  },
  { inputs: [], name: "locker", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  {
    inputs: [
      {
        components: [
          { internalType: "string", name: "name", type: "string" },
          { internalType: "string", name: "symbol", type: "string" },
          { internalType: "string", name: "logo", type: "string" },
          { internalType: "string", name: "description", type: "string" },
          {
            components: [
              { internalType: "string", name: "twitter", type: "string" },
              { internalType: "string", name: "telegram", type: "string" },
              { internalType: "string", name: "discord", type: "string" },
              { internalType: "string", name: "website", type: "string" },
              { internalType: "string", name: "farcaster", type: "string" },
            ],
            internalType: "struct PonsLaunchFactory.Socials",
            name: "socials",
            type: "tuple",
          },
          { internalType: "address", name: "feeWallet", type: "address" },
        ],
        internalType: "struct PonsLaunchFactory.TokenParams",
        name: "params",
        type: "tuple",
      },
      { internalType: "uint256", name: "launchConfigId", type: "uint256" },
      { internalType: "uint256", name: "dexId", type: "uint256" },
      { internalType: "bytes32", name: "salt", type: "bytes32" },
      { internalType: "address", name: "tokenDeployer", type: "address" },
    ],
    name: "predictTokenAddress",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
