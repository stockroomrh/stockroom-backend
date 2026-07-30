# Stage 0 — Repository Audit & Backend Implementation Plan

Status: **audit complete, no functional changes made**. Read this alongside `README.md`, `FRONTEND_COMPLETION.md`, `CLAUDE_HANDOFF.md`, and `docs/PRODUCT_BRIEF.md`. Stop here for review before Stage 1 begins.

---

## 1. Current repository state

### Service interfaces (`lib/services.ts`)

One file is the entire data seam. 23 exported functions, all `async`, all simulating latency via a `wait()` helper:

- Reads: `getProjects`, `getProjectBySlug`, `getProjectBundle`, `getTreasurySummary`, `getTreasuryHistory`, `getPositions`, `getProjectAsset`, `getActivity`, `getPolicy`, `getAgentReports`, `getRecommendations`, `getUserProjects`
- Writes: `createLocalProject`, `requestMockTradeQuote`, `updateProjectAssetRules`, `resetLocalProjects`
- Store plumbing: `subscribeProjectStore` (window `storage` + custom `stockroom-projects-updated` event), `readLocalBundles`/`writeLocalBundles` (localStorage key `stockroom:local-projects:v1`)

Every component (`components/project/*`, `components/dashboard/*`, `components/platform/ExploreView.tsx`, `OperatorConsole.tsx`, `LaunchWizard.tsx`, `ProjectSelector.tsx`) calls these functions **directly**, wrapped only by the one generic hook `components/data/useAsyncData.ts`. There is no per-domain hook layer and **no existing Preview/Live split of any kind** — there is only one implementation today, which is entirely mock/local.

### Schemas (`lib/schemas.ts`)

Zod schemas mirroring `lib/types.ts` almost 1:1 (`ProjectSchema`, `TreasurySummarySchema`, `TreasuryPositionSchema`, `ActivityItemSchema`, `TreasuryPolicySchema`, `AgentReportSchema`, `RecommendationSchema`, `TradeQuoteSchema`, etc.). Notably:

```ts
// Next.js bundles Zod internally... Replace this import with `zod` when the production dependency is installed.
import { z } from "next/dist/compiled/zod";
```

`zod` is **not** an installed dependency yet — this must be added for real server-side validation. No schema currently exists for `UserProject`, `ProjectBundle` (whole), or `LaunchProjectInput`.

### localStorage usage

Two independent keys, both client-only:
- `stockroom:local-projects:v1` — user-created mock projects (`lib/services.ts`)
- `stockroom:last-project` — last-viewed project slug for nav persistence (`components/AppShell.tsx`)

No cookies, no session storage, no server-set state anywhere.

### wagmi / viem / Supabase / chain tooling

`package.json` dependencies are **only** `next@15.4.6`, `react@19.1.1`, `react-dom@19.1.1` (`devDependencies`: `@types/*`, `typescript`). There is **no** wagmi, viem, `@supabase/supabase-js`, ethers, ` zod` (real package), or any blockchain/DB SDK installed at all. This is a fully clean slate.

### Environment files

None exist (`.env`, `.env.local`, `.env.example` all absent). No `process.env` reads anywhere in the codebase.

### API routes

None. `app/api/**` does not exist. Every page under `app/app/**` is a server component that renders a client view component, which calls `lib/services.ts` directly in the browser.

### Authentication state

None, anywhere. `components/AppShell.tsx` renders `<button className="wallet-button">Connect Wallet</button>` with **no onClick handler** — purely decorative. `OperatorConsole.tsx` explicitly labels itself `"Mock authentication · no wallet or transaction connection"`. `ProjectSettingsView.tsx` states `"Production permissions are not connected."` No session, no cookie, no JWT, no Context of any kind exists in the app (`grep` for `createContext`/`Provider` across `app/` and `components/` returns zero hits).

### Launch flow (`components/LaunchWizard.tsx`)

Six-step client component matching the brief's launch flow exactly: Project details → Token configuration → Treasury configuration → Treasury policy (with live `SupportedAssets` editor) → Treasury Agent → Review & launch. On submit it calls `createLocalProject(input)` from `lib/services.ts`, which slugifies the name, builds a full `ProjectBundle` (project/token/summary/history/positions/policy/reports/recommendations) from scratch with fabricated numbers, and writes it into the `stockroom:local-projects:v1` localStorage array. There is no draft/publish distinction — creation is atomic and immediate. `LaunchProjectInput` (in `lib/types.ts`) is the exact shape Stage 2 needs to persist server-side.

### Operator Room (`components/OperatorConsole.tsx`, rendered by `components/dashboard/OperatorView.tsx`)

Client component driven entirely by local `useState`: recommendation selection, an editable proposed amount, a "Request mock quote" button calling `requestMockTradeQuote()`, approve/reject/pending status buttons (state kept only in a local `localStatuses` map, never persisted), a "Pause trading" toggle (local state only), a transaction-classification `<select>` with a non-wired "Save mock classification" button, and an asset-policy editor wired to the real `updateProjectAssetRules()` call (the one piece of this screen with actual persistence today). Policy-blocking logic (`requiresAssetApproval`, `recommendationBlocked`, `amountExceedsAssetLimit`) is already implemented **client-side** here and will need to move server-side as the deterministic policy engine in Stage 4 — this is useful reference logic, not a placeholder to delete.

### Supported-assets structure (`lib/asset-catalog.ts`, `components/SupportedAssets.tsx`)

`TREASURY_ASSET_CATALOG` is a static array of 8 assets (USDG, ETH, NVDAx, AAPLx, TSLAx, AMZNx, METAx, SPYx) with only `symbol`/`name`/`type` — **no chain ID, no contract address, no decimals**. `createAssetRules(approvedSymbols, maximumSingleAsset)` merges this catalog with approval/allocation defaults (USDG always approved, 100% allocation, $100k single-purchase cap; others default to the passed `maximumSingleAsset`% and a $2,500 single-purchase cap, `agentMayRecommend` true only if approved and non-reserve, `automaticExecution` always `false`). `components/SupportedAssets.tsx` is the shared editor UI used by both the launch wizard's policy step and the operator console's asset-management panel. This entire catalog needs to become the seed data for the real `asset_registry` table (Stage 3) with canonical addresses added — it must not be trusted as-is for Live mode since it has no contract addresses to validate against.

---

## 2. Proposed backend folder structure

```
app/api/
  auth/session/route.ts
  projects/route.ts                       # list/create (owner-scoped)
  projects/[slug]/route.ts                # get/update/publish
  projects/[slug]/operators/route.ts
  projects/[slug]/treasury/route.ts       # summary + positions
  projects/[slug]/treasury/history/route.ts
  projects/[slug]/activity/route.ts
  projects/[slug]/policy/route.ts
  projects/[slug]/policy/versions/route.ts
  projects/[slug]/assets/route.ts         # approved-asset management
  projects/[slug]/agent/reports/route.ts
  projects/[slug]/agent/generate/route.ts
  projects/[slug]/recommendations/route.ts
  projects/[slug]/recommendations/[id]/route.ts
  trade/quote/route.ts
  trade/execute/route.ts
  chain/sync/route.ts                     # manual + cron resync target
  cron/treasury-sync/route.ts
  cron/weekly-report/route.ts

lib/
  services.ts             # becomes mode-aware dispatcher (Preview vs Live)
  services.preview.ts      # current lib/services.ts, renamed, unchanged behavior
  services.live.ts         # same exported function names, calls the API routes above
  mode.ts                  # AppMode ("preview" | "live") state: localStorage + event, mirrors services.ts's own idiom
  supabase/
    client.ts             # browser client (anon key only)
    server.ts             # server client (service-role key, server-only import)
    middleware.ts         # session refresh
  server/
    auth/
      session.ts           # verify Supabase session + wallet-signature check
      roles.ts              # owner/operator/viewer helpers
    chain/
      robinhood-config.ts   # chain IDs 4663 (mainnet) / 46630 (testnet), RPC URLs from env
      client.ts             # viem public client via Alchemy
      balances.ts            # multicall balanceOf/decimals/uiMultiplier reader
      receipts.ts
    assets/
      registry.ts            # verified asset_registry reads, seeded from lib/asset-catalog.ts + canonical addresses
      price-feeds.ts          # Chainlink reads
      valuation.ts            # multiplier-adjusted valuation, allocation bps
    policy/
      policy-engine.ts        # deterministic validation, ports OperatorConsole's client-side checks server-side
    ai/
      cfo-prompt.ts
      cfo-schema.ts           # Zod schema for Claude's structured output
      cfo-service.ts          # server-only Anthropic call, validation, one retry, deterministic fallback
    trading/
      zero-x-client.ts
      quote-validation.ts
      allowance.ts
      execution.ts
    db/
      queries.ts              # typed Supabase queries per table

supabase/
  migrations/
    0001_profiles.sql
    0002_projects.sql
    ...                        # one migration per table/group, see §3

contracts/                      # Stage 6 only, separate workspace
  src/StockroomToken.sol
  script/
  test/
```

## 3. Exact tables / migrations required

UUID primary keys, `created_at`/`updated_at` on every table, per your spec:

`profiles`, `projects`, `project_members`, `project_tokens`, `treasury_accounts`, `treasury_policies`, `treasury_policy_versions`, `asset_registry`, `project_approved_assets`, `agent_settings`, `treasury_positions`, `treasury_snapshots`, `activity_items`, `agent_reports`, `recommendations`, `recommendation_events`, `trade_quotes`, `trade_executions`, `deployment_records`, `audit_logs`.

Notes specific to this codebase's existing types:
- `projects` maps to `lib/types.ts`'s `Project` (add `owner_profile_id`, `status: "draft"|"published"`, drop nothing — keep field names close to existing `slug`/`ticker`/`treasuryAddress`/`treasuryObjective`/`socials` so `services.live.ts` can produce the exact same `Project` shape `ProjectSchema` already validates).
- `treasury_policies` + `treasury_policy_versions` together replace the single `TreasuryPolicy.history[]` array currently embedded in mock data — versioning moves from an in-object array to real rows.
- `project_approved_assets` is the real-world version of `TreasuryAssetRule[]`; `asset_registry` is new (no current equivalent) and must carry canonical `contract_address`/`chain_id`/`decimals`/`current_multiplier`, which `lib/asset-catalog.ts` does not have today.
- `recommendations` gets the full status enum from your spec (`proposed`→...→`cancelled`), replacing the current simplified `ProposalStatus` type (`Pending`/`Approved`/`Rejected` per `lib/types.ts`) — `services.live.ts` will need a mapping layer so the existing frontend `ProposalStatus` union either grows or is fed a projected/simplified status.
- RLS: public/anon read on published `projects` + their public-facing tables (`treasury_snapshots`, `treasury_positions`, `activity_items` where not internal, `agent_reports` where `is_public`, `treasury_policies`); owner/operator-scoped read-write via `project_members`; all service-role-only tables (`audit_logs`, `deployment_records`, raw quote payloads) never exposed to `anon`/`authenticated` roles directly — only through Route Handlers using the server client.

## 4. Exact API routes required

Listed in §2's `app/api/` tree above. All mutating routes (`POST`/`PATCH`) validate request bodies with Zod before touching Supabase; all responses validated against the existing `lib/schemas.ts` schemas (extended, not replaced) before being returned, so `services.live.ts` can trust the shape matches what `services.preview.ts` already produces.

## 5. Exact environment variables required

See `.env.example` (created alongside this document, no real values). Summary:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

NEXT_PUBLIC_CHAIN_ID=46630
NEXT_PUBLIC_BLOCK_EXPLORER_URL=
ALCHEMY_ROBINHOOD_RPC_URL=

ZEROX_API_KEY=
ANTHROPIC_API_KEY=

NEXT_PUBLIC_FLAGSHIP_PROJECT_SLUG=stockroom
NEXT_PUBLIC_ENABLE_LIVE_MODE=false
NEXT_PUBLIC_ENABLE_TRADING=false

USDG_ADDRESS=
WETH_ADDRESS=
```

`SUPABASE_SERVICE_ROLE_KEY`, `ZEROX_API_KEY`, and `ANTHROPIC_API_KEY` must never be prefixed `NEXT_PUBLIC_` and must only be read inside `app/api/**` route handlers / `lib/server/**` modules, never imported by any file under `components/` or any client component.

## 6. Exact frontend files that will change (and when)

- `lib/services.ts` — rewritten as the Preview/Live dispatcher (Stage 1, minimal — dispatch only what's wired; unwired functions keep calling `services.preview.ts`).
- New `lib/mode.ts`, `components/mode/ModeProvider.tsx`, `components/mode/ModeToggle.tsx`, `components/mode/ModeBanner.tsx` (Stage 1) — the toggle itself, mounted in `components/AppShell.tsx`'s existing `<header className="topbar">` next to the current (still-decorative-until-Stage-1) wallet button.
- `components/data/useAsyncData.ts` — add a second subscription (`subscribeMode` alongside the existing `subscribeProjectStore`) so every existing view refetches automatically on mode switch. One-line addition, no other component touched.
- `components/AppShell.tsx` — wallet-button gets a real `onClick` wired to Supabase Sign-in-with-Web3 (Stage 1); `ModeProvider`/`ModeToggle`/`ModeBanner` mounted here.
- `components/LaunchWizard.tsx` — Stage 2 only: `launch()` branches on mode, calling `createLocalProject` (Preview, unchanged) or a new live equivalent hitting `POST /api/projects` (Live).
- `components/OperatorConsole.tsx` — Stage 4/5: quote/approve/classify actions branch on mode; the existing client-side policy-blocking logic gets mirrored server-side rather than deleted (client-side check stays as an instant-feedback UX layer, server re-validates authoritatively).
- `components/dashboard/ProjectSettingsView.tsx` — Stage 2/3: asset-policy save and operator-wallet management call live routes when in Live mode.
- **Not touched at all through Stage 6:** `lib/types.ts`, `lib/schemas.ts` shapes (only additive changes), every public `components/project/*` view (they only ever call `lib/services.ts`, which is the seam absorbing all the change), visual system, logo, routing structure.

## 7. Exact security boundaries

- Treasury Agent (Anthropic call) lives only in `lib/server/ai/cfo-service.ts`, invoked only from `app/api/projects/[slug]/agent/generate/route.ts`. It receives pre-computed numbers, returns structured JSON validated against `cfo-schema.ts`, and never sees or produces a contract address, private key, or executable calldata.
- `lib/server/policy/policy-engine.ts` runs independently after every Agent report and again immediately before every quote request and every execution — the Agent's own output is never trusted as policy-compliant.
- All chain reads go through `lib/server/chain/*` using canonical addresses from `asset_registry`, never from user/browser input or from the LLM.
- All 0x quote requests are server-side (`ZEROX_API_KEY` never reaches the browser); the browser only ever receives a validated transaction payload to sign.
- No private key or seed phrase is ever stored, logged, or accepted as input, anywhere in this plan — every treasury is a user-controlled address, multisig, or smart account from day one.
- `SUPABASE_SERVICE_ROLE_KEY` is read only inside `lib/supabase/server.ts` and `app/api/**`; RLS is the backstop for every other access path.

## 8. Exact implementation order

Matches your staging exactly: **Stage 0 (this document) → Stage 1 (Supabase + wallet login) → Stage 2 (live project creation) → Stage 3 (Robinhood Chain treasury data) → Stage 4 (live Treasury Agent + policy engine) → Stage 5 (quotes + human-signed trades) → Stage 6 (live token deployment) → Stage 7 (production hardening)**, each stage ending with typecheck + tests + a report of files created/modified, env vars, migrations, and risks, then a stop for approval.

---

## Remaining risks / open items carried into Stage 1

- No Supabase project or Alchemy RPC account has been provisioned yet — Stage 1 is blocked on those existing or being created first.
- No real treasury wallet address has been designated for the flagship project yet.
- `lib/asset-catalog.ts` has no canonical contract addresses — these must be sourced from Robinhood's `/rhj/assets` endpoint (per `docs/PRODUCT_BRIEF.md` §10) before `asset_registry` can be seeded correctly for Stage 3.
- The current `ProposalStatus`/`Recommendation`/`TradeQuote` types are simpler than the full status enum specified for `recommendations` — Stage 4/5 will need a small additive schema change (new statuses), which is the one place this plan anticipates a `lib/types.ts` change beyond pure addition.
