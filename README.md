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
├── index.html                                       # Entire SPA (~5,067 lines, vanilla JS)
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
  "check_in": "2026-04-15T16:00:00Z",
  "check_out": "2026-04-18T11:00:00Z",
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
- **Schema line count**: `supabase-schema.sql` is ~790 lines; `index.html` is ~5,067 lines.
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
