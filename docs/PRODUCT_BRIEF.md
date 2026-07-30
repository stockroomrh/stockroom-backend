# PUBLIC — AI-Assisted Onchain Treasury

## Product and Engineering Brief

**Status:** Initial specification
**Working name:** PUBLIC
**Network:** Robinhood Chain
**Primary asset:** USDG
**Primary integration:** Robinhood Stock Tokens
**Trading provider:** 0x Swap API
**AI provider:** Anthropic Claude
**Launch scope:** One flagship treasury, with multi-project architecture underneath

---

# 1. Product in one sentence

PUBLIC is a transparent onchain treasury that holds USDG and Robinhood Stock Tokens, while an AI CFO analyses the portfolio, publishes financial reports and proposes trades for a human operator to approve.

The simplest explanation is:

> A token project with a public investment portfolio and an AI CFO.

PUBLIC itself will be the first treasury using the system. Later, other Robinhood Chain projects can connect their wallets and create their own public treasury pages.

---

# 2. The narrative

Normal token projects show:

* token price
* market cap
* volume
* holder count
* social links

PUBLIC additionally shows:

* treasury value
* cash reserves
* Stock Token positions
* asset allocation
* transaction history
* revenue received
* operating runway
* investment policy
* AI-generated financial reports
* proposed and completed treasury actions

The core positioning is:

> **Memecoins have charts. PUBLIC gives them balance sheets.**

Alternative language:

> **The first AI-assisted public treasury on Robinhood Chain.**

> **A treasury that thinks in public.**

> **Watch an onchain company build its balance sheet in real time.**

The platform should not call the project token equity or claim that token holders legally own the treasury.

---

# 3. What the product actually does

PUBLIC has a dedicated treasury wallet on Robinhood Chain.

That wallet can hold:

* USDG
* ETH for gas
* Robinhood Stock Tokens
* tokenized ETFs
* approved crypto assets
* potentially the project’s own token

The application reads the wallet, calculates the value of every asset and presents the treasury as a public balance sheet.

Claude receives the structured treasury data and produces a report such as:

> PUBLIC currently holds $38,420 in assets.
> USDG reserves have fallen from 64% to 57%, below the treasury’s 60% target.
> The AI CFO recommends allocating the next $2,000 of available income to USDG before making further Stock Token purchases.

The operator can then:

* approve the recommendation
* reject it
* edit it
* leave it pending

When approved, the application fetches a live swap quote.

For example:

> Sell 1,000 USDG
> Receive approximately 6.8 NVDA Stock Tokens

The operator signs the transaction using their wallet. The assets arrive directly in the treasury wallet.

The backend never controls the private key.

The end-to-end loop is:

> Treasury receives funds → app reads portfolio → AI analyses portfolio → AI proposes action → operator approves → wallet executes swap → dashboard updates → public report is published.

---

# 4. Important technical foundation

Robinhood Chain is an EVM-compatible Layer 2 with chain ID `4663`. Standard Solidity, viem, wagmi, ethers.js, Foundry and Hardhat tooling can be used. ETH is the native gas token. Robinhood recommends Alchemy for production RPC access.

Robinhood Stock Tokens are standard ERC-20 tokens with 18 decimals. They can be held, transferred, approved and composed like other ERC-20 assets. They are tokenized debt securities that provide economic exposure to an underlying stock or ETF; they are not direct legal ownership of the referenced company’s shares.

Robinhood’s official documentation identifies RFQ liquidity through providers including 0x, 1inch Fusion and LiFi, as well as AMM liquidity through venues such as Uniswap and Rialto. Normal users buy through secondary-market liquidity; direct minting and burning with the issuer is restricted to authorized participants and requires KYB onboarding.

0x officially supports Robinhood Chain, chain ID `4663`, through its Swap API and Gasless API.

---

# 5. Recommended MVP

The first release should support one project: PUBLIC.

The underlying database should be multi-project capable, but the public interface does not initially need a permissionless company creator.

## Included in the MVP

### Public treasury dashboard

Show:

* total treasury value
* USDG reserve
* ETH gas reserve
* Stock Token holdings
* allocation by asset
* seven-day and thirty-day treasury change
* realized deposits and withdrawals
* transaction history
* AI CFO report
* treasury policy
* proposed actions
* executed actions
* links to every transaction on Blockscout

### AI CFO

Claude should:

* summarize current holdings
* compare allocation against treasury policy
* flag concentration risk
* flag low cash reserves
* calculate approximate runway
* explain recent transactions
* suggest portfolio actions
* publish scheduled treasury reports

Claude should not:

* control a wallet
* store a private key
* sign transactions
* invent token addresses
* calculate balances itself
* bypass policy restrictions
* promise returns
* describe recommendations as guaranteed profit

### Human-approved trades

The operator should be able to:

1. Open an AI recommendation.
2. Review the suggested trade.
3. Request a current 0x quote.
4. See expected output, price impact, estimated gas and fees.
5. Approve the spending allowance where required.
6. Sign the swap.
7. Wait for transaction confirmation.
8. See the treasury update.

### Supported assets

Initially support a curated allowlist:

* USDG
* WETH or native ETH
* three to five Robinhood Stock Tokens
* one tokenized ETF, subject to liquidity

Do not attempt to support every available Stock Token in the first release.

The allowlist should be configuration-driven, not hardcoded throughout the application.

---

# 6. What is deliberately excluded from the MVP

The first version should not include:

* automatic AI trading
* backend-held private keys
* user deposits into a pooled investment vault
* automated rebalancing
* margin or leveraged positions
* lending and borrowing
* dividends paid to project-token holders
* guaranteed returns
* permissionless company creation
* token launch contracts
* treasury ownership claims
* legally binding shareholder voting
* cross-chain portfolio management
* automated buybacks
* complex governance
* custom DEX or market-maker infrastructure

These features create significantly more engineering, security and regulatory complexity without being required to prove the narrative.

---

# 7. User roles

## Public visitor

Can:

* view treasury value
* view holdings
* view allocation
* read AI reports
* inspect activity
* open transactions in Blockscout
* view the treasury policy
* see pending and completed recommendations

Cannot:

* submit trades
* change policy
* label transactions
* trigger private administrative actions

## Treasury operator

Can:

* connect an authorized wallet
* generate an AI review
* approve or reject recommendations
* request quotes
* sign transactions
* label incoming and outgoing transactions
* update public project information
* propose policy updates

## Administrator

Can:

* manage authorized operator addresses
* configure supported assets
* configure system prompts
* pause trade functionality
* manage API keys
* hide spam assets
* correct transaction classifications
* manage jurisdiction restrictions

The admin interface should never expose private keys because the application should never hold them.

---

# 8. Treasury design

## MVP treasury

Use a dedicated, publicly known EVM wallet address.

The address should be:

* controlled by the project team
* separated from personal wallets
* preferably backed by a hardware wallet
* never imported into the backend
* stored as project configuration in the database

The application only reads the address until an authorized operator connects and signs a transaction.

## Recommended production treasury

Before substantial value is held, migrate to a multisig or programmable smart account that supports Robinhood Chain.

Robinhood Chain supports ERC-4337 and EIP-7702 account abstraction, including transaction batching, spend policies, session keys and gas sponsorship through providers such as Alchemy and ZeroDev. These capabilities are useful later but are not necessary for the first release.

## Treasury policy example

```json
{
  "baseCurrency": "USDG",
  "minimumReserveBps": 6000,
  "maximumSingleAssetBps": 2000,
  "maximumCryptoAllocationBps": 1500,
  "maximumTradeBps": 1000,
  "allowedAssets": ["USDG", "NVDA", "AAPL", "SPY", "WETH"],
  "requireHumanApproval": true,
  "allowAutomatedExecution": false
}
```

This means:

* at least 60% should remain in USDG
* no individual non-USDG asset may exceed 20%
* crypto exposure may not exceed 15%
* one trade may not use more than 10% of treasury value
* every trade requires a human signature

All percentages should use basis points rather than floating-point numbers.

---

# 9. Funds entering the treasury

The treasury can receive money through several sources.

## Initial seed

The team deposits USDG into the treasury at launch.

This creates the first balance sheet and gives the AI CFO capital to analyse.

## Product revenue

Any revenue generated by the protocol can be sent to the treasury address.

Examples:

* premium treasury pages
* launch fees
* subscription fees
* API access
* AI report fees
* partner fees

## In-app swap fee

0x supports affiliate fees in Swap API requests. PUBLIC could eventually add a small, clearly disclosed fee to trades executed through the application and route the fee to the protocol treasury.

This should be optional for the first release.

## Manual deposits

Any wallet can transfer supported assets to the treasury.

The app should detect and display these deposits automatically.

The operator can label them as:

* treasury seed
* product revenue
* partner revenue
* grant
* token proceeds
* refund
* miscellaneous income

These classifications live in the database. The blockchain transaction remains the source of truth for the amount and sender.

---

# 10. Robinhood Stock Token integration

## Asset discovery

Robinhood exposes read-only endpoints under:

```text
https://api.robinhood.com/rhj/
```

The `/assets` endpoint provides:

* asset ID
* token symbol
* token name
* chain deployments
* canonical contract address
* current multiplier
* pending multiplier
* asset status
* logos
* trading capabilities

The API is documented as rate-limited to 60 requests per second and responses are cached.

The backend should periodically cache the official asset list.

Never trust a token based only on its name or ticker. Robinhood explicitly warns developers to use canonical contract addresses because a different token can use the same ticker.

## Canonical base assets

At the time of this specification, Robinhood documents:

```text
USDG: 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
WETH: 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
```

These should still be loaded from a central chain configuration rather than repeated across the codebase.

## Balances

For each supported ERC-20:

```solidity
balanceOf(treasuryAddress)
decimals()
symbol()
```

Use multicall where possible to reduce RPC requests.

Do not rely on token symbols for identity. Use chain ID plus checksummed contract address.

## Corporate-action multiplier

Robinhood Stock Tokens implement `uiMultiplier()` through ERC-8056.

The raw `balanceOf()` does not change when dividends or stock splits alter the economic share-equivalent amount. The multiplier changes instead.

Relevant display calculations:

```text
tokenValue = rawTokenBalance × multiplierAdjustedTokenPrice

shareEquivalent =
rawTokenBalance × uiMultiplier / 1e18
```

Robinhood’s Chainlink feed already returns the multiplier-adjusted value of one Stock Token. Do not apply the multiplier again when using that feed.

---

# 11. Price and valuation architecture

## Source of truth

Use two different layers:

### Onchain valuation

Use Chainlink feeds when:

* validating an actionable recommendation
* checking policy compliance
* calculating maximum trade size
* confirming portfolio value before a trade
* creating contract-level logic later

Every Stock Token has a Chainlink-compatible price feed. The feed returns the value of one token including the corporate-action multiplier.

### Offchain display data

Use Robinhood’s REST API for:

* logos
* token metadata
* underlying bid and ask
* asset status
* corporate actions
* multiplier metadata

Robinhood’s `/prices` REST values represent the raw underlying equity price and are not multiplier-adjusted. The application must apply `currentMultiplier` when combining REST prices with token balances.

## Price freshness

Every price object should contain:

```typescript
type AssetPrice = {
  chainId: number;
  tokenAddress: `0x${string}`;
  priceUsd: string;
  source: "chainlink" | "robinhood_rest" | "swap_quote";
  updatedAt: string;
  isStale: boolean;
};
```

The application must not present an actionable trade using stale data.

Robinhood notes that Stock Token Chainlink feeds update 24/5. Outside the update window, the interface should warn that market data may not be actively updating and that execution spreads could differ from the displayed valuation.

The engineer should read the heartbeat for each Chainlink feed from Chainlink’s source-of-truth configuration rather than using one universal stale threshold.

---

# 12. Trading integration

## Provider

Use 0x Swap API for the first implementation.

Reasons:

* official Robinhood documentation identifies 0x RFQ as a liquidity route
* 0x supports Robinhood Chain ID `4663`
* it returns executable transaction data
* it can route across multiple available liquidity sources
* gasless support can be explored later
* optional affiliate-fee support is available

## Trade flow

### Step 1: Recommendation

Claude recommends:

```json
{
  "action": "BUY",
  "symbol": "NVDA",
  "targetAllocationBps": 1500,
  "suggestedNotionalUsd": "1000",
  "rationale": "Technology exposure is below the approved target."
}
```

### Step 2: Backend validation

The server validates:

* NVDA is on the allowlist
* canonical contract address is known
* asset status permits trading
* prices are fresh
* USDG balance is sufficient
* minimum reserve remains intact
* maximum trade size is not exceeded
* concentration limit is not exceeded
* recommendation has not expired

The LLM must never provide the final trusted contract address.

### Step 3: Quote

Request a quote for:

```text
chainId: 4663
sellToken: USDG contract
buyToken: canonical NVDA contract
sellAmount: amount in USDG base units
taker: connected operator address
```

Store:

* provider
* quote ID where available
* sell amount
* expected buy amount
* minimum buy amount
* allowance target
* transaction target
* transaction data
* estimated gas
* provider fees
* integrator fee
* price impact
* expiration

### Step 4: Allowance

Check the current USDG allowance for the exact provider spender.

Where possible:

* approve only the required amount
* use Permit2 or gasless approval where properly supported
* clearly display the spender
* do not silently request unlimited approval

### Step 5: Execution

The user signs:

1. allowance transaction, when required
2. swap transaction

The frontend submits the transaction and stores the hash.

### Step 6: Confirmation

Once confirmed:

* mark execution complete
* refresh balances
* refresh valuation
* create a treasury snapshot
* attach the transaction to the recommendation
* publish a plain-English activity entry
* regenerate the relevant dashboard components

Example public activity:

> Purchased approximately $1,000 of NVDA Stock Tokens using USDG after operator approval.

## Failure handling

The UI must handle:

* quote expiry
* insufficient allowance
* insufficient USDG
* insufficient ETH for gas
* price movement
* transaction rejection
* transaction revert
* unsupported asset
* stale price
* liquidity unavailable
* provider downtime
* corporate-action pause
* region restriction
* RPC timeout

No recommendation should be marked executed until a successful receipt is obtained.

---

# 13. AI CFO specification

## AI role

Claude is an analyst and proposal generator.

It is not the accounting source of truth and it is not the execution authority.

All numerical inputs should be calculated before they reach Claude.

## Inputs

The AI receives structured data:

```json
{
  "project": {
    "name": "PUBLIC",
    "objective": "Maintain a transparent diversified treasury"
  },
  "policy": {
    "minimumReserveBps": 6000,
    "maximumSingleAssetBps": 2000,
    "maximumTradeBps": 1000
  },
  "portfolio": {
    "totalValueUsd": "38420.52",
    "positions": []
  },
  "cashFlow": {
    "revenue30dUsd": "4250.00",
    "expenses30dUsd": "1600.00",
    "runwayMonths": "8.4"
  },
  "recentTransactions": [],
  "previousRecommendations": []
}
```

## Required output

Claude must return validated JSON:

```typescript
type CFOReport = {
  summary: string;
  financialHealth: "strong" | "stable" | "watch" | "critical";
  findings: Array<{
    title: string;
    explanation: string;
    severity: "info" | "warning" | "critical";
  }>;
  recommendations: Array<{
    action: "HOLD" | "BUY" | "SELL" | "BUILD_RESERVES";
    symbol: string | null;
    suggestedNotionalUsd: string | null;
    targetAllocationBps: number | null;
    rationale: string;
    policyReference: string;
  }>;
  publicReport: string;
};
```

Validate output using Zod or an equivalent schema.

If validation fails:

* retry once with the validation error
* do not publish malformed output
* store the failed generation in internal logs
* provide a neutral fallback summary generated deterministically

## Policy engine

The backend must independently check every recommendation.

Example:

Claude proposes buying $5,000 of NVDA.

The policy engine determines:

* maximum permitted trade is $3,842
* the trade would reduce USDG below 60%
* resulting NVDA allocation would exceed 20%

The recommendation is marked:

> Rejected by policy engine.

The LLM cannot override this.

## Prompting rules

The system prompt should tell Claude:

* use only supplied financial data
* do not invent prices or transactions
* do not promise performance
* do not describe the token as equity
* clearly distinguish observation from recommendation
* state when information is insufficient
* focus on policy compliance, concentration, liquidity and runway
* avoid sensational investment language
* output JSON only

## Report cadence

MVP:

* manual “Generate review” action
* weekly scheduled public report
* optional report after a completed trade
* optional report after a large deposit or withdrawal

Do not regenerate on every block or price movement.

---

# 14. Recommended architecture

## Frontend

* Next.js
* TypeScript
* App Router
* Tailwind CSS
* viem
* wagmi
* a wallet-connection library compatible with chain ID `4663`
* TanStack Query
* lightweight chart library
* Zod
* Blockscout links

## Backend

Two reasonable options:

### Option A: Next.js full stack

Use:

* server routes
* server actions
* scheduled jobs
* Supabase
* Vercel

This is the fastest MVP route.

### Option B: Separate API

Use:

* Next.js frontend
* FastAPI or Node API
* Supabase Postgres
* Railway

This is preferable only if the engineer expects more indexing jobs, multiple data providers or future public API traffic.

For the first version, Option A is sufficient.

## Infrastructure

* Vercel for frontend/server routes
* Supabase Postgres and Auth
* Alchemy Robinhood Chain RPC/WebSocket
* 0x API
* Anthropic API
* Sentry
* optional Upstash Redis for quote and metadata caching

A full node is unnecessary. Robinhood explicitly advises using public or managed RPC infrastructure unless a team knows it requires its own node.

## Suggested repository structure

```text
/apps
  /web

/packages
  /chain
    robinhood-config.ts
    balances.ts
    multicall.ts
    receipts.ts

  /assets
    robinhood-assets.ts
    token-registry.ts
    price-feeds.ts
    valuation.ts

  /trading
    zero-x-client.ts
    quote-validation.ts
    allowance.ts
    execution.ts

  /ai
    cfo-prompt.ts
    cfo-schema.ts
    cfo-service.ts

  /policy
    policy-engine.ts
    recommendation-validator.ts

  /database
    schema.ts
    queries.ts

  /ui
    shared-components
```

---

# 15. Suggested database model

## `projects`

```text
id
slug
name
ticker
description
logo_url
website_url
token_address
treasury_address
chain_id
status
created_at
updated_at
```

## `project_operators`

```text
id
project_id
wallet_address
role
is_active
created_at
```

## `treasury_policies`

```text
id
project_id
version
base_currency_address
minimum_reserve_bps
maximum_single_asset_bps
maximum_crypto_bps
maximum_trade_bps
allowed_asset_addresses
require_human_approval
effective_at
created_by
created_at
```

Policies should be versioned rather than overwritten.

## `asset_registry`

```text
chain_id
asset_uid
contract_address
symbol
name
decimals
logo_url
current_multiplier
status
is_approved
metadata_updated_at
```

## `price_cache`

```text
chain_id
contract_address
price_usd
source
source_updated_at
is_stale
created_at
```

## `treasury_snapshots`

```text
id
project_id
block_number
total_value_usd
reserve_value_usd
captured_at
```

## `treasury_positions`

```text
id
snapshot_id
contract_address
raw_balance
display_balance
price_usd
value_usd
allocation_bps
```

## `treasury_transactions`

```text
id
project_id
tx_hash
block_number
from_address
to_address
asset_address
raw_amount
value_usd_at_execution
direction
classification
public_label
confirmed_at
created_at
```

## `cfo_reports`

```text
id
project_id
snapshot_id
report_type
financial_health
summary
public_report
model
prompt_version
raw_response
is_public
created_at
```

## `recommendations`

```text
id
report_id
project_id
action
asset_symbol
asset_address
suggested_notional_usd
target_allocation_bps
rationale
policy_result
status
expires_at
approved_by
approved_at
created_at
```

Statuses:

```text
draft
policy_rejected
pending_approval
approved
quote_ready
submitted
confirmed
failed
rejected
expired
```

## `trade_quotes`

```text
id
recommendation_id
provider
sell_token
buy_token
sell_amount
expected_buy_amount
minimum_buy_amount
estimated_gas
provider_fee
integrator_fee
price_impact_bps
allowance_target
transaction_target
transaction_data_encrypted
expires_at
created_at
```

## `trade_executions`

```text
id
quote_id
recommendation_id
operator_address
approval_tx_hash
swap_tx_hash
status
failure_reason
submitted_at
confirmed_at
```

## `audit_logs`

Record every sensitive administrative operation.

---

# 16. Application pages

## `/`

Landing page.

Content:

* main narrative
* live treasury value
* latest AI CFO statement
* allocation preview
* recent activity
* “View the treasury” call to action

## `/treasury`

Primary public dashboard.

Components:

* total net asset value
* reserve percentage
* thirty-day change
* revenue and expenses
* runway
* allocation chart
* holdings table
* balance-sheet view
* transaction feed

## `/assets/[symbol]`

Asset detail:

* token name
* current treasury position
* value
* allocation
* average acquisition price where calculable
* recent purchases and sales
* current Robinhood multiplier
* official contract
* price-source status

## `/cfo`

AI CFO page.

Show:

* latest report
* financial-health classification
* findings
* recommendations
* previous reports
* policy validation result
* approved and rejected actions

## `/activity`

Complete treasury activity ledger.

Filters:

* deposits
* withdrawals
* trades
* revenue
* expenses
* buybacks
* unclassified

## `/policy`

Public treasury constitution.

Show:

* reserve requirement
* asset limits
* approved assets
* trade-size limit
* approval model
* current policy version
* policy history

## `/admin`

Protected operator dashboard.

Include:

* generate report
* review recommendation
* request quote
* sign trade
* classify transactions
* manage supported assets
* update project information
* emergency-pause trading
* inspect system health

---

# 17. Visual direction

The product should feel like:

* Robinhood
* a public company investor-relations page
* an institutional treasury dashboard
* a modern AI operating system

Avoid:

* generic chatbot layouts
* cartoon robots
* excessive gradients
* fake terminal text
* exaggerated sci-fi graphics
* cluttered DeFi dashboards
* displaying every metric at once

Primary visual objects:

* balance sheet
* treasury allocation
* AI CFO memo
* financial-health status
* public activity ledger
* proposal cards
* policy-compliance indicators

The AI should appear as an institutional financial operator, not a chat companion.

---

# 18. Security requirements

## Private keys

* never store private keys
* never request seed phrases
* never sign from the backend
* never log wallet signatures
* never expose service-role keys to the browser

## Asset validation

* only use canonical addresses
* maintain an explicit allowlist
* ignore spam tokens
* validate chain ID before every action
* checksum all addresses
* verify decimals
* disable unsupported assets

## Quotes

* fetch quotes server-side where API keys are required
* never trust price or calldata supplied by the browser
* validate quote target against known provider contracts
* validate sell and buy token addresses
* validate amount
* validate chain ID
* display all fees
* reject expired quotes
* recheck policy before submission

## AI safety

* LLM output is untrusted
* validate JSON schema
* never let Claude return executable calldata
* never let Claude select arbitrary contract addresses
* never let external token metadata enter the system prompt untreated
* calculate all balances and percentages in deterministic code
* log prompt version and model
* maintain a manual kill switch

## Operational safeguards

* pause new quotes without hiding the public dashboard
* rate-limit report generation
* rate-limit quote requests
* enforce operator wallet allowlist
* use signed authentication messages
* expire admin sessions
* maintain Sentry alerts for failed swaps and stale data

---

# 19. Compliance and geographical restrictions

This cannot be ignored in the trading interface.

Robinhood’s current documentation says Stock Tokens may not be offered or delivered in the United States or to U.S. persons. It also identifies restrictions affecting jurisdictions including Canada, the United Kingdom and Switzerland, with the complete restricted-jurisdiction list contained in the formal offering documents.

Engineering implications:

* the public read-only dashboard can remain separate from trade access
* the trade button should support jurisdiction gating
* users should provide an eligibility attestation before trading
* restricted-region configuration must be remotely updateable
* terms and risk disclosures must be accepted
* do not advertise Stock Tokens as ordinary shares
* do not state that project-token holders own treasury assets
* do not promise dividends, revenue sharing or guaranteed buybacks without legal review
* preserve records of disclosure acceptance

The first release can reduce exposure by launching the dashboard and AI CFO globally while enabling in-app trade execution only after the project has established the appropriate legal approach.

---

# 20. Monetization

## Initial

The first objective is narrative and adoption rather than maximizing revenue.

Possible initial revenue:

* optional disclosed swap fee
* premium AI treasury reports
* sponsored ecosystem integrations
* treasury setup services

## Later

When multi-project support opens:

* company setup fee
* monthly treasury dashboard plan
* premium AI CFO subscription
* API access
* custom policy automation
* white-label treasury pages
* percentage fee on in-app swaps
* advanced reporting
* account-abstraction automation fee

0x permits integrators to add disclosed affiliate fees to swap requests, providing one straightforward future revenue route.

---

# 21. Token relationship

The PUBLIC token is separate from the treasury portfolio.

It should not be described as:

* a share in PUBLIC
* legal ownership of the treasury
* a claim against Stock Token holdings
* guaranteed participation in revenue
* guaranteed entitlement to buybacks

Potential token functions can include:

* ecosystem access
* community signalling
* proposal discussion
* unlocking detailed AI reports
* voting on non-binding treasury preferences
* future platform-fee discounts
* future company-launch access

Any direct revenue-sharing or treasury-ownership mechanism requires separate legal and smart-contract analysis.

For the MVP, the treasury narrative and transparent activity are enough. The token contract does not need to be deeply integrated into the application.

---

# 22. Implementation phases

## Phase 1 — Chain and data foundation

Deliver:

* Robinhood Chain connection
* wallet connection
* canonical asset registry
* treasury balance reader
* Chainlink valuation
* Robinhood metadata integration
* treasury snapshots
* Blockscout links
* basic dashboard

Acceptance:

* displayed positions match the wallet
* canonical tokens are correctly recognized
* unknown tokens are hidden by default
* multiplier-adjusted valuation is correct

## Phase 2 — Public financial dashboard

Deliver:

* balance sheet
* allocation chart
* transaction feed
* revenue and expense classification
* policy page
* historical snapshots
* public project page

Acceptance:

* every displayed value has a defined source
* data freshness is visible
* public users do not require authentication
* operator classifications cannot alter onchain amounts

## Phase 3 — AI CFO

Deliver:

* policy schema
* deterministic portfolio calculations
* Claude report generation
* structured recommendation output
* policy validation engine
* report history
* public AI memo

Acceptance:

* Claude cannot invent holdings
* invalid model output does not publish
* policy-breaking recommendations are rejected
* reports clearly separate facts from proposals

## Phase 4 — Trading

Deliver:

* 0x quote integration
* allowance detection
* wallet approval flow
* swap execution
* transaction tracking
* post-trade refresh
* failure states
* fee and slippage display

Acceptance:

* no private keys enter the backend
* quote assets match approved assets
* user sees expected output and fees
* expired quotes cannot execute
* completed swaps update the dashboard

## Phase 5 — Launch polish

Deliver:

* responsive design
* loading states
* empty states
* analytics
* Sentry
* rate limits
* legal disclosures
* region gating
* scheduled weekly report
* admin controls
* production monitoring

---

# 23. Engineering acceptance criteria

The MVP is complete when:

1. A visitor can view the treasury without connecting a wallet.
2. The dashboard displays USDG, ETH and approved Stock Token positions.
3. Portfolio valuation correctly handles Robinhood’s multiplier.
4. The application clearly shows data freshness.
5. Claude can generate a valid structured CFO report.
6. Recommendations are validated against deterministic policy rules.
7. An authorized operator can request a 0x quote.
8. The operator can approve and sign the swap.
9. The application never controls the treasury key.
10. A successful transaction updates the public treasury page.
11. Every action is linked to its onchain transaction.
12. Restricted-region trade access can be disabled independently.
13. The app has no pooled user deposits.
14. The app makes no legal-equity or guaranteed-return claims.
15. A system administrator can pause new trade creation.

---

# 24. Suggested environment variables

```text
NEXT_PUBLIC_CHAIN_ID=4663
NEXT_PUBLIC_BLOCK_EXPLORER_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

SUPABASE_SERVICE_ROLE_KEY=
ALCHEMY_ROBINHOOD_RPC_URL=
ZEROX_API_KEY=
ANTHROPIC_API_KEY=

TREASURY_ADDRESS=
USDG_ADDRESS=
WETH_ADDRESS=

ROBINHOOD_ASSET_API_BASE=https://api.robinhood.com/rhj
AI_CFO_MODEL=
AI_CFO_PROMPT_VERSION=
```

Do not expose:

* `SUPABASE_SERVICE_ROLE_KEY`
* `ZEROX_API_KEY`
* `ANTHROPIC_API_KEY`

to client-side code.

---

# 25. Testing requirements

## Unit tests

Test:

* token decimal normalization
* portfolio valuation
* allocation basis points
* multiplier calculations
* policy limits
* reserve-floor validation
* recommendation validation
* stale-price handling
* quote validation
* transaction classification

## Integration tests

Test:

* Robinhood asset endpoint parsing
* Chainlink feed reads
* RPC multicall
* 0x quote request
* Supabase writes
* Claude schema validation

## End-to-end tests

Test:

* wallet connection
* operator authentication
* report generation
* recommendation approval
* quote display
* rejected signature
* successful swap
* failed swap
* dashboard refresh

## Testnet strategy

Verify whether the required Robinhood Stock Tokens and liquidity are available on testnet.

Where they are unavailable, use:

* mock ERC-20 USDG
* mock Stock Tokens
* mock Chainlink-compatible feeds
* a mock swap router

Then run final low-value integration tests on mainnet.

---

# 26. Future roadmap

After the first treasury works:

## Connected project treasuries

Projects connect an existing wallet and receive:

* public balance sheet
* asset classifications
* AI CFO reports
* treasury policy
* transparent activity page

## Company creation

A creator enters:

* company name
* ticker
* objective
* treasury style
* reserve target
* supported assets

Claude generates the initial policy and public company description.

## Smart treasury accounts

Add:

* multisig execution
* transaction batching
* gas sponsorship
* session keys
* strict spend limits
* approved destination lists

## Automated execution

Only after extensive testing:

* scheduled rebalancing
* maximum daily trade limits
* emergency pause
* oracle freshness requirements
* mandatory slippage limits
* operator override
* limited agent permissions

## Public registry

Rank projects by:

* treasury value
* reserve ratio
* thirty-day growth
* revenue
* runway
* policy compliance
* AI report history
* transaction transparency

This becomes:

> The financial registry for Robinhood Chain projects.

---

# 27. Final product summary for the engineering team

Build a public treasury application on Robinhood Chain.

The treasury is a normal wallet holding USDG, ETH and selected Robinhood Stock Tokens.

The application:

1. Reads the treasury wallet.
2. Identifies canonical assets.
3. Values positions using Chainlink and Robinhood data.
4. Stores historical snapshots.
5. Displays a public balance sheet.
6. Sends structured data to Claude.
7. Publishes an AI CFO report.
8. Validates proposed actions against deterministic policy.
9. Fetches executable trades from 0x.
10. Requires an authorized human wallet to sign every transaction.
11. Updates the public dashboard after confirmation.

Do not build custody, pooled deposits, autonomous execution or permissionless company creation in the first release.

The launch product is:

> **PUBLIC — an AI-assisted treasury that holds real onchain financial assets and operates transparently in public.**
