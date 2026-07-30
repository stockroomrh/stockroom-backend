/**
 * Deploy StockroomToken to a configured network.
 *
 * THIS SCRIPT IS A LOCAL/TESTNET-ONLY CONVENIENCE FOR THE CONTRACTS TEAM.
 * It is never invoked by the running Stockroom application. Per this
 * project's core safety rules, the server must never hold or use a private
 * key to deploy contracts on behalf of users — real, production token
 * deployments happen client-side, from the end user's own connected wallet,
 * via the frontend. Use this script only for the contracts team's own
 * manual testnet deployments and testing.
 *
 * Usage:
 *   cd contracts
 *   npm run deploy:testnet
 *   # or, for mainnet (once real RPC/key values exist):
 *   npm run deploy:mainnet
 *
 * Configuration is read from environment variables (see .env.example):
 *   ROBINHOOD_TESTNET_RPC_URL   RPC endpoint for the robinhoodTestnet network
 *   ROBINHOOD_MAINNET_RPC_URL   RPC endpoint for the robinhoodMainnet network
 *   DEPLOYER_PRIVATE_KEY        Private key used ONLY by this script, locally
 *
 * Token parameters are also read from environment variables, with sensible
 * defaults for a quick local/testnet smoke test:
 *   TOKEN_NAME                  default: "Stockroom Test Token"
 *   TOKEN_SYMBOL                default: "STEST"
 *   TOKEN_TOTAL_SUPPLY          default: "1000000" (whole tokens, pre-decimals)
 *   TOKEN_INITIAL_RECIPIENT     default: the deployer's own address
 *   TOKEN_TREASURY_ADDRESS      default: none (address(0), no treasury split)
 *   TOKEN_TREASURY_BPS          default: "0" (basis points, 0-10000)
 *   TOKEN_OWNER                 default: the deployer's own address
 *
 * Example (PowerShell):
 *   $env:TOKEN_NAME="My Launch Token"; $env:TOKEN_SYMBOL="MLT"; `
 *   $env:TOKEN_TOTAL_SUPPLY="1000000"; $env:TOKEN_TREASURY_ADDRESS="0x..."; `
 *   $env:TOKEN_TREASURY_BPS="1000"; npm run deploy:testnet
 */
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const name = process.env.TOKEN_NAME || "Stockroom Test Token";
  const symbol = process.env.TOKEN_SYMBOL || "STEST";
  const totalSupplyWhole = process.env.TOKEN_TOTAL_SUPPLY || "1000000";
  const initialRecipient =
    process.env.TOKEN_INITIAL_RECIPIENT || deployer.address;
  const treasuryAddress =
    process.env.TOKEN_TREASURY_ADDRESS || ethers.ZeroAddress;
  const treasuryAllocationBps = Number(process.env.TOKEN_TREASURY_BPS || "0");
  const initialOwner = process.env.TOKEN_OWNER || deployer.address;

  const totalSupply = ethers.parseUnits(totalSupplyWhole, 18);

  console.log("Deploying StockroomToken with:");
  console.log({
    name,
    symbol,
    totalSupply: totalSupply.toString(),
    initialRecipient,
    treasuryAddress,
    treasuryAllocationBps,
    initialOwner,
    deployer: deployer.address,
  });

  const Factory = await ethers.getContractFactory("StockroomToken");
  const token = await Factory.deploy(
    name,
    symbol,
    totalSupply,
    initialRecipient,
    treasuryAddress,
    treasuryAllocationBps,
    initialOwner
  );
  await token.waitForDeployment();

  console.log(`StockroomToken deployed to: ${await token.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
