# Renovo Co. CRM — Project Context for Claude

## What This Project Is

Internal CRM and operations platform for Renovo Co., an Airbnb cleaning and staging company in Abilene, TX. Owners: Caleb Gabbert (Founder & Financials), Kennan Dowling (Media Director), Mitchell (Operations).

## Architecture

**Single-file vanilla JS SPA** — `index.html` (~5,742 lines) contains all HTML, CSS, and JS. No build step, no framework, no npm. Deployed as a static site on Vercel. Backend is Supabase (PostgreSQL + Auth + Storage + Realtime + Edge Functions).

```
/
├── index.html                    # Entire SPA
├── supabase-schema.sql           # Full DB schema (run in Supabase SQL Editor)
├── vercel.json                   # Static SPA routing — no build step
├── .env.example                  # Env var reference
└── supabase/
    └── functions/
        ├── booking-webhook/      # Auto-create jobs from platform bookings
        ├── quickbooks-oauth/     # Initiate QB OAuth flow
        ├── quickbooks-callback/  # Handle QB OAuth redirect + store tokens
        ├── quickbooks-sync/      # Sync invoice to QuickBooks API
        ├── quickbooks-payment-check/ # Poll QB for payment status
        └── invite-user/          # Admin: create/edit/delete users
```

## Key Credentials (already in index.html)

```js
const SUPABASE_URL = 'https://qofwwztuykerlcxfuutv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SRrLgFY1zPiplYahG6b5nw_oXKzWkVv';
```

The anon/publishable key is intentionally public — Supabase RLS protects data.

## Database (14 tables)

`profiles`, `clients`, `properties`, `bookings`, `jobs`, `employees`, `job_assignments`, `checklists`, `checklist_items`, `invoices`, `media`, `activity_log`, `integration_tokens`, `messages`

All tables have RLS enabled. `integration_tokens` is admin-only (QB OAuth tokens).

## Business Rules (hardcoded)

**Pricing (in `calcJobPrice()` and `booking-webhook/index.ts`):**
- Base: $80
- Per bedroom: +$30 (only if < 4 bedrooms)
- Per bathroom: +$20 (only if < 4 bedrooms)
- 4+ bedrooms: $230 flat rate (negotiated) — NO per-room charges
- Rush: +$75
- Deep clean: ×2 multiplier
- Staging: custom quote (admin enters agreed price)

**Standard checklist** (`STANDARD_CHECKLIST` constant, 32 items):
- Living Areas (6), Kitchen (7), Bathrooms (8), Bedrooms (3), Laundry (4), Final Walkthrough (4)
- Laundry is REQUIRED: Wash linens → Dry linens → Replace linens on all beds → Fold towels

**Automation:**
- Booking confirmed → job + checklist auto-created (both via UI `syncAllBookingJobs()` and webhook)
- Job marked complete → invoice auto-created (30-day net terms)
- Invoice past due_date → auto-marked overdue on dashboard load

## Role-Based Access

**Admin** (Caleb, Kennan, Mitchell): all pages
**Employee** (field contractors): Job Board, Calendar, Checklists, Documents, Team, Messages only

Role-based nav: `data-admin-only` attribute on sidebar links, hidden via `.employee-mode` CSS class.

RLS now enforces this at the DB level too for `clients`/`properties`/`bookings`/`invoices` (read open, write admin-only) and `employees` (insert/delete admin-only). Three narrow exceptions remain open to all authenticated users because client-side code performs them under the acting employee's own session, not the admin's: `invoices` INSERT (job completion auto-creates the invoice), `employees` UPDATE (job completion increments `jobs_completed` for every assigned employee, not just the actor), and `jobs` UPDATE (crew self-coordination — assigning employees, starting/completing jobs). All three are now scoped rather than wide open: the `invoices_insert` policy requires non-admin inserts to be `status='pending'` and match a real completed job's `job_id`/`amount`/`client_id` (admins can still create arbitrary manual invoices); the `trg_restrict_employee_update` trigger on `employees` blocks non-admins from changing anything except bumping `jobs_completed` by exactly 1 — `pay_rate`, `role`, `status`, and contact fields are admin-only regardless of the RLS policy's USING clause; and the `trg_restrict_employee_job_update` trigger on `jobs` blocks non-admins from changing pricing (`total_price` and its components), scheduling, `property_id`/`booking_id`, or `job_type`, and from setting `status` to `cancelled` — they may only update `status` (non-cancelled), `notes`, and `updated_at`. This closes the gap where a non-admin could otherwise call the Supabase API directly to inflate/deflate `total_price`, which feeds straight into the auto-created invoice.

`media` (job photos/documents) is read/insert/update-open to all authenticated users by design — any team member uploads and views shared files for any job — but DELETE is admin-only, on both the `media` table row and the underlying `storage.objects` file, so a non-admin can't permanently destroy a coworker's uploaded proof-of-work photo or client document. `invoices` UPDATE (e.g. marking paid) is also admin-only at the RLS layer; the UI hides and the JS functions reject the relevant actions for non-admins as well, so there's no path where an employee sees a control that silently fails against RLS.

## Edge Functions

Deploy with:
```bash
supabase functions deploy booking-webhook --no-verify-jwt
supabase functions deploy quickbooks-oauth
supabase functions deploy quickbooks-callback --no-verify-jwt
supabase functions deploy quickbooks-sync
supabase functions deploy quickbooks-payment-check
supabase functions deploy invite-user
```

Required secrets (set in Supabase Dashboard → Edge Functions → Secrets):
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS
- `SUPABASE_ANON_KEY` — verifies user sessions in QB/invite functions
- `BOOKING_API_KEY` — webhook auth key
- `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI`
- `APP_URL` — Vercel deployment URL (for QB OAuth return)

`SUPABASE_URL` is auto-injected by Supabase runtime.

## Navigation / Router

Hash-free SPA routing via `nav(page)` function. Pages: dashboard, jobs, calendar, clients, properties, bookings, checklists, invoices, documents, team, employees, messages, integrations, settings.

## Real-time Features

- Job board: Supabase Realtime subscription on `jobs` table — auto-refreshes with filter state preserved
- Messages: Supabase Realtime on `messages` table — dedicated team chat
- Channels cleaned up on page navigation

## QuickBooks Integration

Full OAuth 2.0 flow:
1. User clicks "Connect QuickBooks" → `quickbooks-oauth` generates auth URL with CSRF state
2. QB redirects to `quickbooks-callback` → stores access + refresh tokens in `integration_tokens`
3. App detects `?qb_connected=true` param → shows success toast
4. "Sync to QB" → `quickbooks-sync` creates/updates invoice in QB, stores QB invoice ID
5. "Sync Payments" → `quickbooks-payment-check` polls QB for balance = 0 → marks paid

Token auto-refresh is handled in both `quickbooks-sync` and `quickbooks-payment-check`.

## Booking Webhook

Endpoint: `POST https://qofwwztuykerlcxfuutv.supabase.co/functions/v1/booking-webhook`
Auth: `Authorization: Bearer <BOOKING_API_KEY>`

Supported platforms: `airbnb`, `vrbo`, `booking.com`, `direct`
Deduplication: `UNIQUE(platform, external_booking_id)` constraint in DB

Configure via Zapier/Make:
- Airbnb: Zapier trigger "New reservation" → webhook action
- VRBO: Zapier trigger → same webhook
- Booking.com: Zapier or Connectivity API → same webhook

## Common Development Tasks

**Modify pricing:** Update `calcJobPrice()` in `index.html` (line ~742) AND `booking-webhook/index.ts` (line ~26) — they must stay in sync.

**Modify checklist template:** Update `STANDARD_CHECKLIST` in `index.html` (line ~764) AND `booking-webhook/index.ts` (line ~48) — keep in sync.

**Add a new page:** Add render function (e.g., `renderNewPage()`), add to `pages` object in `nav()`, add sidebar link with appropriate `data-admin-only` if needed.

**Modify user roles:** Only via `invite-user` edge function (bypasses RLS). The `prevent_role_self_escalation` trigger prevents non-admins from self-promoting.

## Supabase Project Info

- Project ref: `qofwwztuykerlcxfuutv`
- Region: default
- Auth: public signup disabled, users created by admins only
- Storage bucket: `media` (public, 50 MiB max)
- Realtime: enabled on `jobs` and `messages` tables

## GitHub

Repository: https://github.com/CGabbert59/Renovo-co-archive
Default branch: main
