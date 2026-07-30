# Stockroom Contracts

Standalone Hardhat (TypeScript) workspace for the Stockroom token-deployment
contracts. This directory is intentionally self-contained — its own
`package.json`, its own dependencies — so it can be built, tested, and
maintained independently of the Next.js frontend at the repo root.

## What's here

- `contracts/StockroomToken.sol` — the ERC-20 token contract used for
  treasury/launch token deployments.
- `test/StockroomToken.test.ts` — Hardhat/Chai/ethers tests.
- `scripts/deploy.ts` — a local/testnet deployment script for the contracts
  team's own use (see below — this is never used by the running app).
- `hardhat.config.ts` — network config for `robinhoodTestnet` (chain id
  46630) and `robinhoodMainnet` (chain id 4663).

## Install

```
cd contracts
npm install
```

## Compile

```
npm run compile
```

## Test

```
npm run test
```

## Deploy to testnet

```
npm run deploy:testnet
```

Requires a `contracts/.env` file (copy `contracts/.env.example`) with:

- `ROBINHOOD_TESTNET_RPC_URL` — RPC endpoint for Robinhood Chain testnet.
- `ROBINHOOD_MAINNET_RPC_URL` — RPC endpoint for Robinhood Chain mainnet
  (only needed for `npm run deploy:mainnet`).
- `DEPLOYER_PRIVATE_KEY` — a private key used only by this local script for
  the contracts team's own manual deployments/testing.

Token parameters (`TOKEN_NAME`, `TOKEN_SYMBOL`, `TOKEN_TOTAL_SUPPLY`,
`TOKEN_INITIAL_RECIPIENT`, `TOKEN_TREASURY_ADDRESS`, `TOKEN_TREASURY_BPS`,
`TOKEN_OWNER`) are also read from the environment with sensible defaults —
see the usage comment at the top of `scripts/deploy.ts`.

## Contract design constraints

`StockroomToken` is deliberately the simplest possible standard ERC-20,
built on OpenZeppelin's audited `ERC20` and `Ownable` base contracts, and
supports only: name, symbol, an 18-decimal fixed total supply minted once at
deployment, an initial recipient, an optional treasury allocation (split at
deploy time via basis points), and a recorded owner. It has **no** hidden or
post-deploy minting, **no** transfer taxes/fees, **no** blacklist/whitelist
mechanics, **no** pausable/honeypot-style transfer blocking, **no** owner
ability to seize user funds, and **no** proxy/upgradeability pattern —
`Ownable` exists only to give the token a standard, informational owner
record for possible future non-mint admin actions, not a backdoor. Separately,
by project-wide policy, the server that runs the Stockroom application never
holds or uses a private key to deploy contracts on behalf of users in
production — `scripts/deploy.ts` in this workspace is strictly a
local/testnet convenience for the contracts team; real deployments happen
client-side from the end user's own connected wallet.
