import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

// Deployer key is a LOCAL/TESTNET-ONLY convenience for the contracts team's
// own scripted deployments (see scripts/deploy.ts and README.md). The running
// application never reads this variable and never holds a private key —
// production deployments happen from the end user's own connected wallet in
// the frontend, not from this workspace or any server process.
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

const ROBINHOOD_TESTNET_RPC_URL =
  process.env.ROBINHOOD_TESTNET_RPC_URL || "";
const ROBINHOOD_MAINNET_RPC_URL =
  process.env.ROBINHOOD_MAINNET_RPC_URL || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    robinhoodTestnet: {
      url: ROBINHOOD_TESTNET_RPC_URL || "http://127.0.0.1:8545",
      chainId: 46630,
      accounts,
    },
    robinhoodMainnet: {
      url: ROBINHOOD_MAINNET_RPC_URL || "http://127.0.0.1:8545",
      chainId: 4663,
      accounts,
    },
  },
};

export default config;
