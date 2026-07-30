# Supabase setup (Stage 1)

## 1. Create the project

1. Go to https://supabase.com/dashboard and sign in (or create an account).
2. Click **New project**.
3. Pick an organization, name it (e.g. `stockroom`), set a database password (save it somewhere — you won't need it day-to-day since the app uses API keys, not a direct Postgres connection), pick a region close to your users, and click **Create new project**. Wait ~2 minutes for provisioning.

## 2. Get your API keys

1. In the project, go to **Project Settings → Data API** (or **Settings → API** on older dashboards).
2. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key (click "reveal") → `SUPABASE_SERVICE_ROLE_KEY`
3. Create a `.env.local` file at the repo root (copy `.env.example` to `.env.local`) and paste the three values in.

**Never commit `.env.local` and never put the service_role key in any `NEXT_PUBLIC_*` variable** — it bypasses every access rule in the database.

## 3. Enable Sign in with Web3 (Ethereum)

1. In the dashboard, go to **Authentication → Sign In / Providers**.
2. Find **Web3** and enable the **Ethereum** option (Supabase added native "Sign in with Ethereum" support — no extra API keys needed for this part).
3. Save.

## 4. Run the migrations

You have two options — pick whichever you're comfortable with.

### Option A — SQL Editor (fastest, no install)
1. In the dashboard, open **SQL Editor**.
2. Open each file in `supabase/migrations/` **in order** (`0001_...sql` through `0008_...sql`), paste its contents, and click **Run**. Do them one at a time, in order — later files depend on tables created earlier.

### Option B — Supabase CLI (better for ongoing changes)
```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>   # found in Project Settings → General
supabase db push                                   # applies every file in supabase/migrations/
```

## 5. Verify

1. In the dashboard, go to **Table Editor** — you should see all 20 tables (`profiles`, `projects`, `project_members`, `project_tokens`, `treasury_accounts`, `treasury_policies`, `treasury_policy_versions`, `asset_registry`, `project_approved_assets`, `agent_settings`, `treasury_snapshots`, `treasury_positions`, `activity_items`, `agent_reports`, `recommendations`, `recommendation_events`, `trade_quotes`, `trade_executions`, `deployment_records`, `audit_logs`).
2. Go to **Authentication → Policies** — every table should show RLS enabled with policies listed (not "No policies created yet").
3. Restart the dev server (`npm run dev`) so it picks up `.env.local`.
4. Switch the app to **Live** mode and click **Connect Wallet** — if you have a browser wallet (MetaMask, Brave, etc.) installed, it should prompt you to connect and then sign a message. After signing, the wallet button should show your address (e.g. `0x1234…abcd`) instead of "Connect Wallet".

## 6. (Optional) WalletConnect for mobile/QR wallets

1. Go to https://cloud.walletconnect.com, sign in, create a project, copy its **Project ID**.
2. Add it to `.env.local` as `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
3. Restart the dev server. Clicking "Connect Wallet" will now show a small menu with two options: your browser wallet, and WalletConnect (which opens a QR code to scan with a mobile wallet app).

If you skip this, only browser-extension wallets work, and the "Connect Wallet" button connects directly without showing a menu.
