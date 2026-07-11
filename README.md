# Renovo Co. — Internal CRM & Operations Platform

Production-ready internal CRM for Renovo Co., an Airbnb cleaning and staging company based in Abilene, TX.

---

## Features

- **Dashboard** — KPI stats, pending jobs, upcoming schedule, live activity feed
- **Jobs** — Full workflow: pending → assigned → in progress → complete, with auto-pricing; filter by property, date range, status, and type
- **Calendar** — Month view of all scheduled jobs
- **Properties** — Property management with access notes (door codes, lockbox, parking)
- **Clients** — Property owner management with QuickBooks customer linking
- **Bookings** — Airbnb, VRBO, Booking.com, and direct bookings with auto-job creation
- **Checklists** — Standard cleaning checklist per job (includes laundry: wash, dry, replace linens)
- **Invoices** — Auto-generated on job completion; print to PDF; export to CSV; QuickBooks sync
- **Documents & Media** — Photo/document uploads via Supabase Storage
- **Team** — Owner profiles (Caleb, Kennan, Mitchell) + overview of all field contractors
- **Employees** — Dedicated field contractor management: CRUD, pay rates, job history, status tracking (admin only)
- **Messages** — Real-time internal team chat (Supabase Realtime)
- **Integrations** — Full QuickBooks OAuth 2.0 flow, booking platform setup guides, webhook docs
- **Settings** — User management (admin only): create, edit, delete users; change roles; reset passwords; all users can edit their own display name and password via the sidebar avatar click

### Business Rules Implemented
- Base rate: $80
- Bedroom charge: +$30 each (for properties < 4 bedrooms)
- Bathroom charge: +$20 each (for properties < 4 bedrooms)
- Rush fee: +$75
- Deep clean: ×2 multiplier
- **4+ bedrooms: $230 flat rate (negotiated)**
- Laundry required on every clean: Wash linens → Dry linens → Replace linens → Fold towels

---

## Tech Stack

- **Frontend**: Vanilla JS + CSS, single-file SPA (`index.html`)
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Realtime + Edge Functions)
- **Deployment**: Vercel (static hosting)
- **Integrations**: QuickBooks Online OAuth 2.0, booking platform webhooks

---

## Repository Structure

```
/
├── index.html                                       # Entire SPA (~5,840 lines, vanilla JS)
├── supabase-schema.sql                              # Full database schema
├── vercel.json                                      # Vercel SPA routing config
├── .env.example                                     # Environment variable reference
└── supabase/
    └── functions/
        ├── booking-webhook/index.ts                 # Auto-create jobs from bookings
        ├── quickbooks-oauth/index.ts                # Initiate QB OAuth flow
        ├── quickbooks-callback/index.ts             # Handle QB OAuth callback + store tokens
        ├── quickbooks-sync/index.ts                 # Sync invoice to QuickBooks API
        ├── quickbooks-payment-check/index.ts        # Check QB for payment status on synced invoices
        └── invite-user/index.ts                     # Admin user management (create/edit/delete users)
```

---

## Complete Setup Guide

### Step 1 — Supabase Project Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the entire contents of `supabase-schema.sql`
   - This automatically creates all 14 tables, RLS policies, indexes, triggers, the `media` storage bucket, and enables Realtime on `jobs` and `messages`
3. Go to **Storage** → verify the `media` bucket exists and is set to **Public**
4. Note your **Project URL** and **Anon Key** from **Project Settings → API**

### Step 2 — Configure Supabase Credentials

The credentials in `index.html` (lines 421–422) are already configured for the Renovo Co. Supabase project:

```javascript
const SUPABASE_URL = 'https://qofwwztuykerlcxfuutv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SRrLgFY1zPiplYahG6b5nw_oXKzWkVv';
```

If deploying to a **different** Supabase project, update those two lines with your own Project URL and Anon Key from Supabase Dashboard → Project Settings → API.

The anon key is intentionally public — Supabase Row Level Security protects your data.

### Step 3 — Deploy Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project (ref = qofwwztuykerlcxfuutv for the configured Renovo project)
supabase link --project-ref qofwwztuykerlcxfuutv

# Deploy all edge functions
# booking-webhook and quickbooks-callback receive non-Supabase auth, so they need --no-verify-jwt
supabase functions deploy booking-webhook --no-verify-jwt
supabase functions deploy quickbooks-oauth
supabase functions deploy quickbooks-callback --no-verify-jwt
supabase functions deploy quickbooks-sync
supabase functions deploy quickbooks-payment-check
supabase functions deploy invite-user
```

### Step 4 — Set Edge Function Secrets

In Supabase Dashboard → **Project Settings → Edge Functions → Add new secret**:

| Secret Name | Value |
|-------------|-------|
| `SUPABASE_SERVICE_ROLE_KEY` | From Project Settings → API (service_role key) |
| `SUPABASE_ANON_KEY` | From Project Settings → API (anon/public key) |
| `BOOKING_API_KEY` | Generate a strong random secret: `openssl rand -hex 32` |
| `QUICKBOOKS_CLIENT_ID` | From developer.intuit.com → your app → Keys & OAuth |
| `QUICKBOOKS_CLIENT_SECRET` | From developer.intuit.com → your app → Keys & OAuth |
| `QUICKBOOKS_REDIRECT_URI` | `https://qofwwztuykerlcxfuutv.supabase.co/functions/v1/quickbooks-callback` |
| `APP_URL` | Your Vercel deployment URL (e.g. `https://renovo-co.vercel.app`) |

`SUPABASE_URL` is automatically available in edge functions. `SUPABASE_ANON_KEY` must be set manually as a secret (used by quickbooks-sync, quickbooks-payment-check, and quickbooks-oauth to verify user sessions).

### Step 5 — Deploy to Vercel

**Option A: GitHub Integration (recommended)**
1. Push this repo to GitHub (already done: `https://github.com/CGabbert59/Renovo-co-archive`)
2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. Select the `Renovo-co-archive` repository
4. **No build settings needed** — Vercel detects the static site automatically (no `npm install`, no build command)
5. **No environment variables needed in Vercel** — Supabase credentials are embedded in `index.html`
6. Click Deploy — note the deployed URL (e.g. `https://renovo-co-archive.vercel.app`)

**Option B: Vercel CLI**
```bash
npm i -g vercel
vercel --prod
```

The `vercel.json` handles SPA routing so all paths serve `index.html`.

**After deployment, complete these two steps with your actual Vercel URL:**

**5a — Update `APP_URL` edge function secret** (required for QuickBooks OAuth callback):
- Supabase Dashboard → Project Settings → Edge Functions → Secrets
- Update `APP_URL` to your Vercel URL (e.g. `https://renovo-co-archive.vercel.app`)

**5b — Update Supabase Auth URL Configuration** (required for password reset emails):
- Supabase Dashboard → Authentication → URL Configuration
- Set **Site URL** to your Vercel URL (e.g. `https://renovo-co-archive.vercel.app`)
- Add the same URL to **Redirect URLs**
- Click Save

### Step 6 — Disable Public Signup (IMPORTANT for Production)

This is a **private internal CRM**. Disable public signup so only admin-created accounts can log in:

1. Supabase Dashboard → **Authentication → Providers**
2. Under **Email**, toggle **"Enable email signup"** to **OFF**
3. Click **Save**

> This prevents anyone with the Supabase URL from creating their own account. Users must be created by an admin (see Step 7).

### Step 7 — Create User Accounts

**Bootstrap the first admin (Caleb):**

1. In Supabase Dashboard → **Authentication → Users** → **Add user → Create new user**
   - Email: `caleb@renovoco.com`  
   - Password: *(set a secure password)*
   - Toggle **"Auto Confirm User"** ON

2. Immediately run this SQL in **Supabase SQL Editor** (no need to wait for first login — the trigger runs on creation):

```sql
UPDATE profiles SET full_name = 'Caleb Gabbert', role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'caleb@renovoco.com');
```

**Add remaining admins via the CRM (preferred):**

3. Log in to the CRM as Caleb → go to **Settings → Users → Add User**
4. Create Kennan and Mitchell with role **Admin** — no SQL needed, the Settings page handles everything

Alternatively, create all three via Supabase Dashboard + run all three UPDATE statements at once:

```sql
UPDATE profiles SET full_name = 'Caleb Gabbert', role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'caleb@renovoco.com');

UPDATE profiles SET full_name = 'Kennan Dowling', role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'kennan@renovoco.com');

UPDATE profiles SET full_name = 'Mitchell', role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'mitchell@renovoco.com');
```

---

## Booking Integration Setup

All booking platforms work through a standardized webhook endpoint.

### Webhook URL

```
POST https://qofwwztuykerlcxfuutv.supabase.co/functions/v1/booking-webhook
Authorization: Bearer YOUR-BOOKING-API-KEY
Content-Type: application/json
```

> Set `BOOKING_API_KEY` in Supabase Edge Function Secrets. Use `openssl rand -hex 32` to generate a strong key.

### Payload Format

```json
{
  "platform": "airbnb",
  "external_booking_id": "HM123456",
  "property_id": "your-property-uuid",
  "guest_name": "John Smith",
  "guest_email": "john@example.com",
  "check_in": "2026-11-15T16:00:00Z",
  "check_out": "2026-11-18T11:00:00Z",
  "total_amount": 450.00,
  "status": "confirmed",
  "guests_count": 2
}
```

When `status` is `"confirmed"`, the webhook automatically:
1. Creates or updates the booking (deduplicates by `platform + external_booking_id`)
2. Creates a cleaning job scheduled for the checkout date
3. Creates a full 32-item checklist (including laundry tasks)
4. Logs the activity

### Per-Platform Setup

**Airbnb** (no public API):
- Use [Zapier](https://zapier.com): "New Airbnb Booking" trigger → POST to webhook
- Or use a channel manager: Hospitable, Lodgify, or Guesty

**VRBO**:
- Use VRBO iCal URL + Zapier calendar trigger → POST to webhook
- Or use VRBO Connectivity API (requires partner access)

**Booking.com**:
- Use Booking.com Connectivity API
- Or use a channel manager like Cloudbeds

**Direct bookings**: Enter manually via the Bookings page in the CRM.

---

## QuickBooks Connection Steps

1. Create an app at [developer.intuit.com](https://developer.intuit.com/app/developer/appdetail)
2. Under **Keys & credentials**, copy your **Client ID** and **Client Secret**
3. Under **Redirect URIs**, add:
   ```
   https://qofwwztuykerlcxfuutv.supabase.co/functions/v1/quickbooks-callback
   ```
4. Set the 6 secrets in Supabase Edge Functions (Step 4 above)
5. In the CRM app, go to **Integrations → Connect QB** → click **Connect with QuickBooks**
6. Authorize the app in QuickBooks
7. You'll be redirected back with "QuickBooks connected!" confirmation

Once connected, sync any invoice to QuickBooks from the **Invoices** page using the **⇄ QB** button.

---

## Environment Variables Reference

| Variable | Used By | Where to Find |
|----------|---------|---------------|
| `SUPABASE_URL` | Embedded in `index.html` | Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | Embedded in `index.html` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge function secrets | Supabase → Project Settings → API |
| `BOOKING_API_KEY` | `booking-webhook` secret auth | Generate with `openssl rand -hex 32` |
| `QUICKBOOKS_CLIENT_ID` | Edge function secrets | developer.intuit.com → Your App |
| `QUICKBOOKS_CLIENT_SECRET` | Edge function secrets | developer.intuit.com → Your App |
| `QUICKBOOKS_REDIRECT_URI` | Edge function secrets | Set to Supabase functions callback URL |
| `APP_URL` | Edge function secrets | Your Vercel deployment URL |

---

## Role-Based Access

| Permission | Admin | Employee |
|------------|-------|----------|
| Dashboard (KPI/revenue) | ✅ | ❌ (lands on Job Board) |
| Job Board | ✅ | ✅ |
| Calendar | ✅ | ✅ |
| Checklists | ✅ | ✅ |
| Documents & Media | ✅ | ✅ |
| Team | ✅ | ✅ (view only) |
| Employees (CRUD) | ✅ | ❌ |
| Messages | ✅ | ✅ |
| Clients | ✅ | ❌ |
| Properties | ✅ | ❌ |
| Bookings | ✅ | ❌ |
| Invoices | ✅ | ❌ |
| Integrations | ✅ | ❌ |
| Delete any record | ✅ | ❌ |
| Edit invoices | ✅ | ❌ |

Caleb, Kennan, and Mitchell are all configured as `admin`. Field contractors who log in are `employee` role.

---

## Automation Summary

| Trigger | Auto Action |
|---------|------------|
| Booking confirmed (webhook or CRM) | Creates cleaning job for checkout date + 32-item checklist |
| Job marked complete | Auto-generates invoice (pending status, due in 30 days) |
| Invoice past due date | Auto-marks as overdue on dashboard load |
| Employee assigned to job | Updates job status to "assigned" |

---

## Pricing Rules

| Scenario | Formula |
|----------|---------|
| Standard clean (1-3 bed) | $80 base + $30/bed + $20/bath |
| Rush clean | Standard price + $75 |
| Deep clean | Standard price × 2 |
| 4+ bedrooms | $230 flat rate (negotiated) |

---

## Local Development

No build step required:

```bash
# Python
python3 -m http.server 3000

# Node.js
npx serve .
```

Open `http://localhost:3000` and sign in with your Supabase credentials.

---

## GitHub Repository

```
https://github.com/cgabbert59/renovo-co-archive
```

---

## Production Checklist

Before going live, verify:

- [ ] `supabase-schema.sql` has been run in Supabase SQL Editor
- [ ] `media` storage bucket exists and is public
- [ ] All 6 edge functions deployed (`supabase functions deploy ...`)
- [ ] All 6 Edge Function Secrets set in Supabase Dashboard
- [ ] Public signup **disabled** in Supabase Auth → Providers → Email
- [ ] User accounts created for Caleb, Kennan, and Mitchell
- [ ] Bootstrap admin SQL run for Caleb (Step 7); Kennan + Mitchell created via Settings page
- [ ] `APP_URL` edge function secret updated to match Vercel deployment URL
- [ ] Supabase Auth → URL Configuration → Site URL set to Vercel deployment URL
- [ ] Supabase Auth → URL Configuration → Redirect URLs includes Vercel deployment URL
- [ ] QuickBooks app created at developer.intuit.com (for QB integration)
- [ ] `BOOKING_API_KEY` set in Supabase secrets + Zapier/Make configured (for webhook sync)

---

## Quick Reference

| Item | Value |
|------|-------|
| Supabase Project | `qofwwztuykerlcxfuutv` |
| Supabase URL | `https://qofwwztuykerlcxfuutv.supabase.co` |
| Booking Webhook | `POST https://qofwwztuykerlcxfuutv.supabase.co/functions/v1/booking-webhook` |
| GitHub Repo | `https://github.com/cgabbert59/renovo-co-archive` |
| Live App | `https://renovo-co-archive.vercel.app` |
| Vercel Deploy | Import repo at vercel.com → no build settings needed |

### All Required Environment Variables

Set these in **Supabase Dashboard → Project Settings → Edge Functions → Secrets**:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Edge functions bypass RLS |
| `SUPABASE_ANON_KEY` | Session verification in QB and invite-user functions |
| `BOOKING_API_KEY` | Webhook auth (`openssl rand -hex 32`) |
| `QUICKBOOKS_CLIENT_ID` | QB OAuth app credential |
| `QUICKBOOKS_CLIENT_SECRET` | QB OAuth app credential |
| `QUICKBOOKS_REDIRECT_URI` | `https://qofwwztuykerlcxfuutv.supabase.co/functions/v1/quickbooks-callback` |
| `APP_URL` | Your Vercel deployment URL |

> **Note:** `SUPABASE_ANON_KEY` must be set both here (for edge functions) AND is already embedded in `index.html` (for the frontend). They are the same value.

These are embedded directly in `index.html` (not needed in Vercel):

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | `https://qofwwztuykerlcxfuutv.supabase.co` |
| `SUPABASE_ANON_KEY` | `sb_publishable_SRrLgFY1zPiplYahG6b5nw_oXKzWkVv` |

---

## Technical Notes

- **Schema is idempotent**: `supabase-schema.sql` is safe to re-run on an existing database. All `CREATE` statements use `IF NOT EXISTS`; policy migrations check existence before acting.
- **Supabase JS SDK**: Loaded via jsDelivr CDN (`@supabase/supabase-js@2`, latest v2) to ensure compatibility with the `sb_publishable_` key format used by newer Supabase projects.
- **QuickBooks tokens**: The `integration_tokens` table is restricted to admin users via RLS. Edge functions bypass RLS using the service role key.
- **QuickBooks OAuth hardening**: `quickbooks-oauth` requires the caller to be an admin and persists the CSRF `state` it issues to `integration_tokens` (written under the caller's own session, so RLS itself enforces the admin check). `quickbooks-callback` requires `--no-verify-jwt` since QuickBooks redirects here directly with no Supabase session — to compensate, it validates the incoming `state` against that stored value (exact match, 15-minute TTL, single-use — cleared immediately after a successful match) before exchanging the authorization code or storing any tokens. This closes the gap where anyone who knew the public callback URL could otherwise complete their own QuickBooks authorization and hijack the connection. `quickbooks-sync` and `quickbooks-payment-check` also now require admin role, matching the Invoices/Integrations pages being admin-only in the UI.
- **Booking platform validation**: `bookings.platform` has a DB-level `CHECK` constraint (`airbnb`, `vrbo`, `booking.com`, `direct`) matching `properties.platform` — previously only the webhook validated this, leaving admin-entered bookings via the CRM unconstrained at the DB layer.
- **Booking deduplication**: The webhook deduplicates bookings by `platform + external_booking_id`. Bookings without an `external_booking_id` (manual entries) are always inserted as new records.
- **Invoice deduplication**: A `UNIQUE (job_id)` constraint on the `invoices` table prevents duplicate invoices from multiple job completion events.
- **Role escalation prevention**: A `BEFORE UPDATE` trigger on the `profiles` table silently blocks non-admin users from changing their own role via direct API calls, even if they bypass the UI. Admins retain full control via the Settings page and edge functions.
- **Write-access hardening**: `clients`, `properties`, `bookings`, and `invoices` are readable by any authenticated user (employee-facing pages join across them), but insert/update/delete are restricted to admins via RLS — the UI already hid these actions from employees, this closes the matching API-level gap. Three narrow exceptions stay open at the RLS layer because client-side code performs them under the acting employee's own session: `invoices` INSERT (job completion auto-creates the invoice), `employees` UPDATE (job completion increments `jobs_completed` for every assigned employee, not just the actor), and `jobs` UPDATE (crew self-coordination — assigning employees, starting/completing jobs). All three are scoped rather than wide open: the `invoices_insert` policy requires non-admin inserts to be `status='pending'` and match a real completed job's `job_id`/`amount`/`client_id`; the `trg_restrict_employee_update` trigger on `employees` blocks non-admins from changing anything except bumping `jobs_completed` by exactly 1 (`pay_rate`, `role`, `status`, and contact fields are admin-only regardless of the RLS policy's USING clause); and the `trg_restrict_employee_job_update` trigger on `jobs` blocks non-admins from changing pricing, scheduling, or property/booking linkage, and from setting `status` to `cancelled` — they may only update `status` (to a non-cancelled value), `notes`, and `updated_at`. The `showJobDetail`/`saveEditJob` UI already only exposed pricing/scheduling fields to admins; this closes the matching direct-API gap so a non-admin can't call `sb.from('jobs').update({total_price:...})` to tamper with the amount that flows into the auto-created invoice.
- **Realtime job board**: The job board subscribes to Supabase Realtime on the `jobs` table. When a job is inserted or updated (by another user or a webhook), the board refreshes automatically and shows a brief toast notification.
- **Messages/activity_log write scoping**: `messages` and `activity_log` were previously `FOR ALL USING(true) WITH CHECK(true)`, letting any authenticated user edit or delete anyone else's chat messages or tamper with/delete audit-log entries. `messages` is now editable/deletable only by its author (admins can delete any message for moderation); `activity_log` is read/insert-only with no UPDATE/DELETE policy, making entries immutable from the client.
- **Pay rate confidentiality**: The Team page (visible to all authenticated users, not just admins) no longer fetches or renders `pay_rate` for non-admin viewers — previously every field contractor's hourly rate was visible to every other contractor on that page. The job detail view and the assignment-tab employee picker/list had the same gap (they embedded `employees(*)`/fetched `employees.select('*')` purely to show a name, shipping every assigned contractor's pay rate to any viewer's network tab on every job load); those queries are now scoped to the columns actually rendered. `showEditContractorModal` also gained an explicit admin check so the edit-contractor prefill (which does need `pay_rate`) can't be triggered by a non-admin calling the function directly. Note the underlying `employees_select` RLS policy is still `USING (true)` for all columns — Postgres RLS can't filter columns, so a non-admin who hand-crafts a raw REST call to `/rest/v1/employees?select=pay_rate` can still retrieve it; closing that fully requires a DB-level fix (e.g. a column-masking view) that should be tested against the live schema before applying.
- **Job creation race condition**: A partial unique index (`jobs_booking_id_active_unique`) prevents two concurrent job-creation calls (e.g. a manual "Sync Jobs" click racing a webhook delivery) from both passing the existing-job check and creating duplicate jobs/checklists for the same booking.
- **Booking-webhook duplicate-delivery handling**: The job-insert path in `booking-webhook` now catches the `23505` unique-violation that `jobs_booking_id_active_unique` raises on a retried/duplicate webhook delivery and re-fetches the already-created job instead of reporting a false partial failure — previously the losing concurrent request returned `207` even though the job had, in fact, been created by the winner.
- **Job-pricing confidentiality on Team page**: The "N jobs" history button on the Team page (visible to all authenticated users) opened a modal that rendered every job's `total_price` regardless of viewer role — a repeat of the pay-rate/job-pricing leak already closed elsewhere. The underlying query and the modal's Price column are now scoped to admins only.
- **Crew-assignment status race**: `assignEmployee`/`removeAssignment` previously read-then-wrote the job's status across separate round trips (insert/delete a `job_assignments` row, then a separate `count()`, then a conditional status update), leaving a window where a concurrent assign/remove on the same job could land in between and leave the job `assigned` with zero crew or `pending` with crew still on it. Both now call a single atomic RPC, `sync_job_assignment_status`, that recomputes status from the live assignment count in one statement.
- **Dashboard query error surfacing**: The four parallel queries behind the owner dashboard previously fell back to empty arrays/zero on failure with no indication anything was wrong, showing a misleadingly empty "$0 revenue, 0 jobs" dashboard. Failures are now logged and surfaced via a warning toast.
- **Realtime channel-drop notification**: The job-board and messages realtime subscriptions previously had no status callback — if the websocket dropped (`CHANNEL_ERROR`/`TIMED_OUT`), the page kept showing stale data with no indication it was no longer live. Both now toast a warning on disconnect.
- **Self-service profile editing**: Any authenticated user can click their avatar in the sidebar to update their display name and change their password. Role changes still require an admin. This runs through `sb.from('profiles').update()` (scoped to the caller's own row by the `profiles_update` RLS policy) for the display name, and `sb.auth.updateUser()` for the password — no admin token or edge function needed for self-service edits.
- **QB OAuth CSRF state check**: The `init()` handler now only rejects a returning QB OAuth callback if *both* the stored state (`sessionStorage.getItem('qb_oauth_state')`) and the returned state are non-empty AND mismatched. When `sessionStorage` is absent (private/incognito tab, browser session restore, single sign-on redirect across origins), the stored state is empty — rejecting in that case produced a false "state mismatch (CSRF)" error even though the server-side callback had already validated and stored the tokens, leaving the user connected but with no toast confirmation and no automatic navigation to the Integrations page.
- **`localToday()` pinned to `America/Chicago`**: The helper now uses `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })` explicitly, so "today" computations are always correct for Abilene, TX regardless of the browser's local timezone setting (an admin using the app from a different timezone would otherwise see wrong dates in the dashboard KPIs, calendar highlights, overdue checks, and invoice due dates).
- **`autoFillInvoiceFromJob()` idempotent fill**: The New Invoice modal's job-selection handler only writes to the amount and client fields if they are currently empty (`!amtEl.value`). Previously it overwrote any existing values every time the job dropdown changed, which broke manual edits the user had already made.
- **Schema line count**: `supabase-schema.sql` is ~1,194 lines; `index.html` is ~5,840 lines.
- **Contractor pay-rate validation**: `createContractor()`/`saveEditContractor()` parsed the pay-rate field with no non-negative check or `min="0"` attribute, unlike every other financial input (invoice/booking amounts) hardened in commit 158db70. A negative rate was already rejected by a DB `CHECK` constraint, but the failure surfaced as a raw Postgres error instead of the same clean warning toast used elsewhere. Both functions now validate `payRate >= 0` client-side, matching the established pattern.
- **Job completion race condition**: `updateJobStatus()` and `saveEditJob()` previously read the job's status, then wrote the new status in a separate query, leaving a window where two simultaneous "mark complete" calls (e.g. two assigned employees finishing at once) would both pass the `prevStatus !== 'completed'` check and double-increment `jobs_completed` for every assigned employee. The completion write is now a single conditional `UPDATE ... WHERE status <> 'completed'`, so only the caller that actually flips the row runs the one-time invoice/checklist/employee-count side effects.
- **Invoice paid_at overwrite**: Editing an already-paid invoice (e.g. to fix a note or amount) previously reset `paid_at` to the current timestamp on every save, destroying the original payment date. `saveEditInvoice()` now only stamps `paid_at` on the first transition into `paid` and clears it if the status is changed away from `paid`.
- **Realtime**: The `jobs` and `messages` tables are added to the Supabase Realtime publication via the schema SQL — no manual configuration needed.
- **Jobs/checklists destructive-write hardening**: `jobs`, `checklists`, and `checklist_items` previously used a single permissive `FOR ALL USING(true) WITH CHECK(true)` policy. Reads and routine writes (status changes, checklist item toggling) stay open to all authenticated users by design — field contractors need full job-board visibility and the ability to start/complete jobs and check off checklist items. But `deleteJob()` and the "⚡ Generate Checklist" button (`createDefaultChecklist()`) are admin-only in the UI with no RLS backing, so any authenticated user could call the Supabase client directly to delete any job (cascading away its checklist/assignments/invoice history) or fabricate checklist rows. RLS now matches the UI: DELETE on `jobs`/`checklists`/`checklist_items` and INSERT on `checklists`/`checklist_items` require admin role; `job_assignments` and `media` remain fully open since any team member legitimately manages job assignments and shared photos/documents for any job.
- **Booking-webhook checklist-creation failure was completely silent**: of the four secondary writes in the auto-job-creation flow (job-cancel, checklist insert, checklist-item insert, activity-log insert), three already logged failures via `console.error`; the checklist row insert itself had no error branch at all, so a failure there left a job with no checklist and zero trace in the function logs. It now logs the same way as its three sibling writes.
- **QuickBooks payment-check silent failures**: `quickbooks-payment-check` marked an invoice `paid` or recorded a partial-payment note without checking whether the database write actually succeeded — a failed update meant the invoice stayed `pending` in the CRM while QB showed it paid, with no record of the failure anywhere. Both writes now check for an error, log it, and surface it in the function's `errors` response array (matching the existing pattern for QB API failures in the same function). `quickbooks-sync`'s QB-customer creation/lookup catch block was also completely silent (a bare `catch` with only a comment); it now logs the error via `console.error` while keeping the same non-fatal behavior (the invoice still syncs without a customer reference).
- **Booking-webhook job-creation failure was masked as success**: when a confirmed booking's job `insert` failed (e.g. a transient DB error), the webhook still returned HTTP 200 with `job_id: null` and a message implying the no-op was intentional ("status not confirmed or job already exists") — indistinguishable from the two legitimate no-op cases. A calling Zapier/Make integration had no way to detect or retry the failure. The webhook now returns HTTP 207 with `success: false` and the underlying error message when job creation fails after the booking itself was upserted successfully.
- **Job pricing confidentiality**: the Job Board, Calendar (month tiles' day-detail modal), and job detail view are intentionally employee-reachable, but all three rendered `total_price` (and the detail view rendered the full base/bedroom/bathroom/rush/deep-clean breakdown) with no admin gate — contradicting the documented employee role split, which excludes financials. Matching the existing `pay_rate` fix pattern: the `Price` column/breakdown is now hidden in the UI for non-admins, and the underlying `jobs` queries in `renderJobs()`, `filterJobs()`, `drawCalendar()`, `calDayClick()`, and `showJobDetail()` are scoped to omit the price columns for non-admins so the figures don't appear in the network response either. As with `pay_rate`, the `jobs_select` RLS policy still permits reading these columns via a raw REST call — the same DB-level column-masking caveat applies.
- **Job-completion race via the checklist-complete path**: `completeChecklist()` (used when an employee finishes the last checklist item) read the job's status and wrote the `completed` transition as two separate queries, leaving the same double-increment window that `updateJobStatus()` already closed with an atomic conditional update. `completeChecklist()` now uses the identical `.update(...).neq('status','completed').select('id')` pattern, so only the call that actually flips the row runs the one-time invoice/employee-count side effects.
- **Edge function CORS hardening**: `quickbooks-oauth`, `quickbooks-sync`, `quickbooks-payment-check`, and `invite-user` previously set `Access-Control-Allow-Origin: '*'`. These four are only ever called via `fetch()` from the SPA using the caller's own session token, so a wildcard origin let any third-party page that obtained a token through some other means read the response cross-origin. They now echo the `APP_URL` secret instead (falling back to `'*'` only if it isn't set yet, so a fresh deploy can't be bricked by missing config). `booking-webhook` and `quickbooks-callback` are unchanged — the former is called server-to-server with its own API key (no browser CORS involved), and the latter is a top-level OAuth redirect from Intuit, not a `fetch()` call, so CORS doesn't apply to it either way.
- **Job pricing leak via the Checklists page**: the prior "Job pricing confidentiality" fix scoped `total_price`/breakdown columns out of non-admin queries on the Job Board, Calendar, and job detail view, but missed the Checklists page — `renderChecklists()` and `openChecklistModal()` both join `jobs(*)`, which is employee-reachable (Checklists has no admin gate) and shipped the full pricing breakdown to every employee's network response even though the checklist UI never renders it. Both queries now use the same `isAdmin() ? '*,...' : 'id,scheduled_date,job_type,...'` column-scoping pattern already used elsewhere for this purpose.
- **integration_tokens race could duplicate the QuickBooks token row**: `quickbooks-oauth` previously did a select-then-branch (update if a `service='quickbooks'` row exists, else insert) with no DB-level uniqueness guard, so two near-simultaneous "Connect QuickBooks" clicks (e.g. two admins, or two tabs) could each pass the existence check and insert duplicate rows. `quickbooks-callback` and `quickbooks-payment-check` both call `.maybeSingle()` on `eq('service','quickbooks')`, which throws if more than one row matches — a duplicate would silently break OAuth completion and payment polling until manually cleaned up in the database. `integration_tokens` now has a `UNIQUE (service)` constraint (the migration de-duplicates any existing rows first, keeping the most recently updated one, so it's safe to re-run against a database that already hit the race), and `quickbooks-oauth` now does a single `upsert(..., { onConflict: 'service' })` instead of the select-then-branch.
- **QuickBooks customer-link write-back was unchecked**: `quickbooks-sync` creates a QB customer for a client on first sync and writes the new `quickbooks_customer_id` back to the `clients` row so future syncs reuse it. That write-back had no error check — if it failed (network blip, RLS edge case), the invoice still synced successfully to QB, but the local client row never recorded the link. The next sync would then call `ensureQBCustomer` again with no known ID and risk creating a second, duplicate QB customer for the same client. The write-back now checks for an error and logs it, matching the existing error-surfacing pattern used for every other secondary write in this function.
- **Job creation had no admin gate, at the UI or the database**: the "+ New Job" button rendered unconditionally on the Dashboard, Job Board, and Calendar (including the calendar day-detail modal) — unlike "+ New Booking", which was already `isAdmin()`-gated — and `createJob()` had no role check either. Worse, the underlying `jobs_insert` RLS policy was `WITH CHECK (true)`, so any authenticated employee could call `sb.from('jobs').insert({...total_price: <anything>})` directly (or just use the unguarded button, including the staging path's free-text "agreed price" field) to fabricate a job at an arbitrary price, then mark it complete themselves (self-completion is intentionally allowed) and have that price flow straight into the auto-created invoice. The button is now `isAdmin()`-gated at all four render sites, `createJob()` checks `isAdmin()` before inserting, and `jobs_insert` now requires `role = 'admin'` via the same `EXISTS (SELECT 1 FROM profiles ...)` pattern used by `jobs_delete_admin` — matching that job creation, like job deletion, is meant to be an admin-only action while routine status updates and assignments stay open to the whole crew.
- **booking-webhook crashed on a malformed check_in/check_out date**: `new Date(check_in).toISOString()` throws an uncaught `RangeError` for any unparseable date string, and this wasn't wrapped in the function's one try/catch (which only covers the JSON body parse) — so a slightly malformed timestamp from a channel manager produced a raw 500 instead of the clean, descriptive 400 every other invalid-input case returns. Both dates are now validated up front (`isNaN(date.getTime())`) and rejected with a 400 before any parsing is relied on downstream.
- **invoices_insert RLS silently blocked legitimate auto-invoices for jobs with a deleted property**: the non-admin branch of the policy used `jobs j JOIN properties p ON p.id = j.property_id` to validate the invoice's `client_id` against the job's property. `jobs.property_id` is nullable (`ON DELETE SET NULL`), so any completed job whose property had since been deleted failed the inner join entirely, causing the whole `EXISTS` check — and the auto-invoice insert performed under the completing employee's own session — to fail with no error surfaced beyond a generic RLS denial. Changed to a `LEFT JOIN` so a null `property_id` correctly falls through to `p.client_id IS NOT DISTINCT FROM invoices.client_id` comparing `NULL = invoices.client_id`, matching intent for clientless jobs instead of rejecting them outright.
- **Missing indexes on FK columns used in real query paths**: `properties.client_id` (client-detail "Properties" list), `job_assignments.job_id` (job-detail "who's assigned" lookups), `activity_log.user_id`, and `messages.user_id` had no index despite being filtered/joined on in existing queries, unlike sibling FK columns (`jobs.property_id`, `bookings.property_id`, etc.) that already were. Added matching `idx_*` indexes for all four.
- **invite-user password-reset bypassed the 8-character minimum**: user creation enforces `password.length < 8`, but the `update_password` action (used by Settings → Users → reset password) had no equivalent check, so an admin could reset another user's password below the app's own stated policy. Added the same length check used on creation.
- **quickbooks-sync customer lookup/creation had no `.ok` check**: unlike the nearly-identical `ensureServicesItem` just above it in the same file, `ensureQBCustomer`'s two QB API calls parsed `.json()` unconditionally. A non-200 QB response (rate limit, expired token mid-request, etc.) would silently yield `undefined` fields instead of a clear error, risking an empty `quickbooks_customer_id` written onto the invoice. Both calls now check `.ok` first and log a descriptive error on failure, matching the established pattern.
- **quickbooks-sync silently reported success when it never actually updated the QuickBooks invoice**: when re-syncing an already-synced invoice, the function first fetches the existing QB invoice to read its `SyncToken` (required by QB's update API). If that fetch failed (rate limit, the QB invoice having been deleted, a transient network error), the code fell back to `qbInvoiceId = existingQbId` and continued straight through to the "success" response — the admin saw "successfully synced to QuickBooks" with no indication that the update API call was never even made. It now returns a 502 with the underlying QB error instead of masking the failure as success.
- **restrict_employee_job_update trigger blocked notes-only edits on already-cancelled jobs**: the trigger's guard was `OR NEW.status = 'cancelled'`, which fires whenever the *resulting* status is `cancelled` — including when a non-admin updates only `notes` on a job that was already cancelled (status unchanged). This contradicted the trigger's own stated intent of allowing non-admins to edit `notes` freely. Changed to `OR (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)` so the block only fires on the actual transition into `cancelled`, not on every subsequent edit to an already-cancelled job.
- **quickbooks-payment-check silently skipped invoices with a malformed QB response**: `parseFloat(qbInv.TotalAmt)` and `parseFloat(qbInv.Balance)` were used directly in comparisons with no `NaN` check. A QB response missing or mangling either field would `parseFloat` to `NaN`, and every comparison against `NaN` (`> 0`, `=== 0`, `<`) evaluates `false` — the invoice would be silently skipped with no entry in the function's `errors` array, unlike every other failure path in the same loop. Added an explicit `isNaN` check that pushes a descriptive error instead of skipping silently.
- **"Today" was computed in UTC, not local time, across ~10 call sites**: `new Date().toISOString().split('T')[0]` converts to UTC before slicing the date — for Abilene, TX (UTC-5/-6), that silently rolls "today" over to tomorrow's date from the evening onward. This previously caused invoices to be auto-marked `overdue` a full day early (Dashboard and Invoices page both ran the overdue update against the wrong "today"), the Dashboard's "today's jobs" count and Job Board's "today" badge to undercount, and the Calendar's "today" highlight to land on the wrong cell in the evening. A `localToday()` helper (using local `getFullYear()`/`getMonth()`/`getDate()`) now backs every "today" computation, the Calendar's month-query date range, and the manual-sync/new-booking default date fields — the same bug class `fmtDate()` was already patched for, just at the call sites that fix never touched.
- **CSV exports had no formula-injection guard**: `exportJobsCSV`, `exportClientsCSV`, `exportBookingsCSV`, and `exportInvoicesCSV` each quoted fields and escaped embedded `"`, but never neutralized a leading `=`, `+`, `-`, or `@` — which Excel/Google Sheets execute as a formula even inside quotes. `guest_name` flows in unsanitized from external booking platforms (via Zapier) into the jobs/bookings exports, so a guest naming themselves e.g. `=HYPERLINK(...)` on Airbnb would have that formula auto-execute when an owner opens the exported CSV. A shared `csvCell()` helper now prefixes any field starting with `=+-@` with a `'` before quoting, used by all four export functions.
- **Failed media-upload DB save left an orphaned storage object**: `doUpload()` uploads the file to the `media` storage bucket first, then inserts the tracking row into the `media` table. If the insert failed, the function returned an error toast but never removed the just-uploaded file, permanently consuming space against the 50 MiB bucket cap with no corresponding row and no way to find or remove it from the UI. `doUpload()` now calls `sb.storage.from('media').remove([path])` on insert failure, matching the cleanup already done on the delete path.
- **Cross-job race could lose an employee's `jobs_completed` increment**: `incrementAssignedEmployeeJobCount()` read an employee's current count in JS, added 1, then wrote it back — a classic lost-update window. An employee assigned to two jobs that both complete within milliseconds of each other (two browser tabs, or a near-simultaneous webhook + manual completion) could have one of the two increments silently rejected by `trg_restrict_employee_update` (its `OLD.jobs_completed + 1` check no longer matches once the other write lands first), permanently undercounting that employee's completed-job total with only a generic warning toast and no way to tell which job's increment was lost. Replaced the read-then-write with a new `increment_employee_jobs_completed(p_employee_id)` SQL function (a single atomic `UPDATE ... SET jobs_completed = jobs_completed + 1`) called via `sb.rpc(...)`, closing the race entirely. **Requires re-running `supabase-schema.sql`** (or just the new function definition) against the live database — existing deployments won't have this RPC until that migration is applied.
- **Booking-cancellation job-cancel failure was swallowed**: when a webhook cancellation tried to cancel the linked job and that update failed, the error was only `console.error`'d — the webhook still returned `success: true`, so the calling Zapier/Make integration had no way to know the job was left active. Now returns HTTP 207 with `success: false` and the underlying error, matching the partial-failure pattern already used for job/checklist creation failures in the same function.
- **A $0 booking amount silently saved as NULL**: `createBooking()` and `submitManualSync()` both parsed the amount field as `parseFloat(value||0)||null` — since numeric `0` is falsy in JS, an explicitly entered `$0` (e.g. a complimentary stay or test booking) collapsed to `null` instead of being stored as `0`, while every other code path (`saveEditBooking()`, invoice amount) already used the correct `value ? parseFloat(value) : null` pattern that only nulls out a genuinely empty field. Both sites now match that pattern.
- **Concurrent admin demotions could leave zero admins**: `invite-user`'s "update_profile" action checked `isLastAdmin()` and then ran the `full_name`/`role` update as two separate round trips. Two concurrent demote requests targeting two *different* admins (e.g. both fired from Settings → Users while exactly 2 admins remained) could each see admin count = 2, both pass the check, and both demote — leaving the CRM with no account able to manage users, roles, or pricing. Replaced with a new atomic RPC, `update_profile_role_safe`, that locks every admin row with `FOR UPDATE` before re-counting and applying the update in one statement, so a second concurrent call blocks until the first commits and correctly sees the post-demotion count. **Requires re-running `supabase-schema.sql`** against the live database for this RPC to exist. The DELETE path's equivalent `isLastAdmin()` check is unchanged and remains a narrow, accepted residual race — the actual mutating event there is a GoTrue Admin API call outside any transaction this function controls, so it can't be folded into the same atomic check without a session-held lock spanning that call, which isn't practical with the stateless RPC/REST connection this function uses. Same caliber of accepted gap as the `pay_rate` column-masking note above.
- **employees.jobs_completed had no non-negative DB constraint**: unlike every other count/financial column (`base_price`, `pay_rate`, `invoices.amount`, `bookings.total_amount`/`guests_count`, `properties.bedrooms`/`bathrooms`), `jobs_completed` had no `CHECK` guard. Non-admin writes were already limited to `+1` per completion by `trg_restrict_employee_update`, but an admin (or a future code path) could still set it negative with no DB-level backstop. Added `employees_jobs_completed_nonneg CHECK (jobs_completed >= 0)`, matching the existing non-negative-guard pattern.
- **booking-webhook accepted a negative total_amount or non-positive guests_count**: both `bookings.total_amount` and `bookings.guests_count` have DB-level `CHECK` constraints (`bookings_amount_nonneg`, `bookings_guests_positive`), but the webhook validated platform/status/dates up front and let these two fall through to a raw constraint-violation 500 instead of a clean 400 — the same bug class the date-validation fix above already addressed, just missed on these two fields. Both are now validated before the upsert and rejected with a descriptive 400.
- **booking-webhook's reschedule-sync only covered `pending` jobs, missing `assigned`**: when a guest changed their checkout date and the platform re-fired the confirmation webhook, the existing-job branch resynced `scheduled_date` only if the job's status was `pending`. A job already in `assigned` (crew picked, clean not yet started) fell into the catch-all `else` branch — whose own comment said "in_progress or completed, nothing to sync," which didn't actually describe what it was catching — so the date change was silently dropped with no error and a `200 success:true` response, leaving the crew scheduled for the old date. The resync branch now also covers `assigned`.
- **Three activity_log inserts in booking-webhook had no error check**: the two cancellation-branch log inserts and the reschedule-branch log insert were stragglers from the activity-log error-surfacing hardening applied to the job-creation branch — a failed write here was silent with no trace, weakening the audit trail specifically for cancellations and reschedules. All three now `console.error` on failure, matching the existing pattern.
- **Realtime channels leaked past logout**: the `SIGNED_OUT` auth handler called `showLogin()` but never tore down `_jobsChannel`/`_messagesChannel` or reset `currentPage`, so logging out while on the Job Board or Messages page left that Postgres-changes subscription running against an unauthenticated client — on the next DB change it would still pass its `currentPage` guard (never reset) and write into the now-hidden DOM. Not a data leak (RLS still applies), but wasted background work and a latent issue on shared/kiosk-style machines. `SIGNED_OUT` now removes both channels and resets `currentPage` before showing the login screen.
- **quickbooks-payment-check silently skipped invoices with a malformed QB response**: when `qbData.Invoice` was absent (QB returned 200 with an unexpected response shape — e.g. the invoice was deleted in the QB UI after syncing), the loop skipped it silently with no entry in `errors[]`, making the "no new payments" summary indistinguishable from an actual clean run. Now pushes a descriptive error so the admin sees it. Also fixed the fully-paid condition: `balance === 0 && total > 0` intentionally keeps the `total > 0` guard to exclude QB-voided invoices (QB zeroes both `TotalAmt` and `Balance` on void, so `total > 0` is the reliable discriminator). The `>= 0` constraint on `invoices.amount` means a $0 invoice with $0 QB balance would be a latent skip, but no creation path currently allows $0 invoices.
- **quickbooks-callback accepted any HTTP method**: unlike every other edge function, this one had no `req.method` check beyond the `OPTIONS` preflight, so a POST/PUT/DELETE to the callback URL was processed identically to the GET that QuickBooks actually redirects with. Not exploitable (it only reads from `url.searchParams`, the same on any method), but inconsistent with the explicit 405 handling everywhere else. Added the matching `GET`-only check.
- **A cancelled job could still be driven to "completed," generating a real invoice and crediting payroll for work never performed**: the atomic `.neq('status','completed')` guard used by `updateJobStatus()`/`saveEditJob()`/`completeChecklist()` to make completion idempotent matches a `cancelled` row just as readily as `pending`/`in_progress`/`assigned`. Nothing excluded a cancelled job from this path — the non-admin status dropdown in `showEditJobModal` offered `completed` regardless of current status, and the checklist modal's "Mark Job Complete" button appeared whenever a (still-toggleable) checklist hit 100%, with no check on the underlying job's status. Any employee — not just an admin — could complete a job the booking webhook or an admin had already cancelled, firing `autoCreateInvoice()` and `incrementAssignedEmployeeJobCount()` for cleaning that never happened. Fixed at three layers: the `restrict_employee_job_update` trigger now also rejects any non-admin transition away from `cancelled` (mirroring the existing `OLD.status = 'completed'` guard, so reviving a cancelled job — to any status — is admin-only, same as cancelling one already was); the employee status dropdown now disables and shows only `cancelled` when the job is already cancelled; and the checklist "Mark Job Complete" button no longer renders when the linked job's status is `cancelled` (its query was widened to fetch `status` for non-admins too, since it previously only fetched the columns the UI rendered). **Requires re-running `supabase-schema.sql`** against the live database for the trigger fix to take effect — the two UI fixes are already live on deploy.
- **`createContractor()`/`saveEditContractor()` silently accepted a blank last name**: both forms mark "Last Name *" as required, but only `createContractor()`'s sibling validation (`saveNewClient`) actually checked both fields — `createContractor()` checked only `first`, and `saveEditContractor()` didn't check `last` at all. A contractor could be created or edited with an empty `last_name` despite the UI marking it mandatory. Both now validate `!first || !last`, matching `saveNewClient`'s pattern.
- **Webhook test tool left permanent junk rows in production data with no cleanup path**: the Integrations page's "Test Webhook" button (by design) POSTs a `status: 'confirmed'` test payload straight at the live `booking-webhook` endpoint to verify connectivity, which auto-creates a real booking + job + 32-item checklist tied to a real property — useful for confirming the integration works, but every run left that test data behind indefinitely with no built-in way to remove it, polluting dashboard revenue/job-count aggregates over time. `runWebhookTest()`'s success panel now includes a "Delete Test Data" button (`cleanupWebhookTest()`) that removes the created checklist/items, assignments, job, and booking in one click. Also added explicit `isAdmin()` checks to `showWebhookTest()`/`runWebhookTest()` themselves (previously gated only by the admin-only Integrations page render and the need to know the `BOOKING_API_KEY` secret), matching the defense-in-depth pattern used everywhere else in this file.
- **Job Detail's "Mark Complete" button bypassed the checklist-completion gate**: the dedicated Checklist modal only shows its "Mark Job Complete" button once the linked checklist hits 100% — but the Job Detail modal's own "✓ Mark Complete" button (shown to any user, not just admins, whenever a job is `in_progress`) had no such check and called the identical `updateJobStatus(id,'completed')`, letting anyone skip every checklist item and still complete the job, generate the invoice, and credit payroll through that path. The button is now disabled (with a "Finish the checklist first (N% complete)" tooltip) whenever the job has a checklist that isn't yet at 100%; jobs with no checklist at all (e.g. checklist generation failed) are unaffected and remain completable as before.
- **The Edit Job modal's status dropdown was a third, untouched path around the same checklist-completion gate**: both prior fixes to this bug class (the Job Detail button above, and the earlier Checklist-modal gate) left `saveEditJob()` itself unguarded — its status `<select>` offers `completed` as an option for both admins and employees regardless of checklist progress, and the save handler ran the full completion side effects (invoice creation, employee job-count increment, checklist auto-closing) with no percentage check. Anyone could open "Edit" on an in-progress job and select Completed to skip the checklist entirely. `saveEditJob()` now runs the identical `items.length === 0 || pct === 100` check before allowing the transition, matching the other two gates.
- **Several "today"/"N days from now" computations were never migrated to `localToday()`**: the UTC-vs-local-time bug this codebase already fixed once (`fmtDate`/`localToday`) was still present at half a dozen call sites that predated that fix or were added after it: the dashboard's week-boundary (`weekEndStr`) and "due soon" threshold, the 7-day revenue chart's day buckets (causing the "today" bar highlight to land on the wrong day in the evening), the Jobs/Checklists page "due this week" filters, `autoCreateInvoice()`'s 30-day due date, and the New Invoice modal's default/fallback due date. All now go through `localToday()` (a new `localDaysFromNow(days)` helper covers the "N days from now" cases) instead of `.toISOString().split('T')[0]`, which truncates to the UTC calendar date and silently rolls dates forward starting at 6 PM local (Abilene, TX is UTC-6).
- **The UI's manual job-creation path used a weaker checkout-date fallback than the webhook**: `autoCreateJobFromBooking()` (used by the "Sync Jobs" button and admin-created bookings) scheduled the clean for `localToday()` when a booking had no `check_out` date, instead of anchoring to the actual stay like `booking-webhook` already does (`check_in + 1 day`). A booking entered without a checkout date got its cleaning job dated to whenever an admin happened to click sync, completely disconnected from the guest's stay. Now mirrors the webhook's fallback exactly.
- **quickbooks-payment-check's two activity_log inserts had no error check**: the same bug class already fixed for booking-webhook's three activity_log inserts — a failed write here (RLS edge case, transient DB error) was silently swallowed since `.insert()` resolves with `{error}` rather than throwing, with no `console.error` and no entry in the function's `errors` response array, unlike every other write in this same function (`paidErr`, `noteErr`). Both inserts (the paid-in-full log and the partial-payment log) now check and log the error, matching the established pattern. The primary invoice-status write these follow is unaffected either way — this only closes the audit-trail gap.
- **Several Settings/Integrations functions skipped the function-level `isAdmin()` guard used everywhere else**: `createUser()`, `saveEditUser()`, `deleteUser()` (Settings → Users) and `startQBOAuth()`, `showQBSetup()`, `saveQBConnection()`, `disconnectQB()` (Integrations → QuickBooks) relied solely on their pages being admin-gated and, for the user-management trio, on `invite-user`'s own server-side admin check — same bug class already fixed once for `showWebhookTest()`/`runWebhookTest()` and `showEditContractorModal()`. Not independently exploitable: `invite-user` verifies admin role itself, and `integration_tokens` carries a `FOR ALL` admin-only RLS policy, so a non-admin calling any of these seven functions directly from devtools was already rejected server-side. All seven now also check `isAdmin()` first, matching the defense-in-depth pattern used throughout this file — fails fast with a toast instead of a wasted round trip to a server-side rejection.
- **Seven more mutation functions had the same missing-`isAdmin()`-guard gap**: `saveNewClient()`, `saveEditClient()`, `createProperty()`, `saveEditProperty()`, `createBooking()`, `saveEditBooking()`, and `createManualInvoice()` were the last write paths in the file without the function-level check already applied to every sibling delete function (`deleteClient()`, `deleteProperty()`, `deleteBooking()`) and to the Settings/Integrations functions above. Same non-exploitable-but-inconsistent shape: the Clients/Properties/Bookings/Invoices pages are already `isAdmin()`-gated and the matching RLS policies (`clients_write_admin`, `properties_write_admin`, `bookings_write_admin`, `invoices_insert`) reject a non-admin's direct API call regardless. All seven now check `isAdmin()` first, closing out this bug class across the whole file.
- **`showWebhookTest()`'s test-date computation used UTC, not local time**: it built the test payload's `check_in`/`check_out` dates with `new Date(...).toISOString().split('T')[0]`, the same UTC-truncation bug already fixed at ~10 other call sites (see the `localToday()` note above) — for Abilene, TX this rolled both test dates one day later starting at 6 PM local. Now uses `localDaysFromNow(1)`/`localDaysFromNow(2)`, matching every other date computation in the file.
- **`createContractor()` was the last mutation function in the file missing the function-level `isAdmin()` guard**: its sibling functions (`saveEditContractor()`, `deleteContractor()`, and every other Clients/Properties/Bookings/Invoices/Settings/Integrations mutation already fixed in prior rounds) all check `isAdmin()` first; `createContractor()` relied solely on the admin-only Employees page render and the `employees_insert_admin` RLS policy. Not independently exploitable — the DB rejects the insert either way — but it closes out this bug class for every write path in `index.html`.
