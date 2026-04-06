# Renovo Co. — Internal CRM & Operations Platform

Production-ready internal CRM for Renovo Co., an Airbnb cleaning and staging company based in Abilene, TX.

---

## Features

- **Dashboard** — KPI stats, pending jobs, upcoming schedule, live activity feed
- **Jobs** — Full workflow: pending → assigned → in progress → complete, with auto-pricing
- **Calendar** — Month view of all scheduled jobs
- **Properties** — Property management with access notes (door codes, lockbox, parking)
- **Clients** — Property owner management with QuickBooks customer linking
- **Bookings** — Airbnb, VRBO, Booking.com, and direct bookings with auto-job creation
- **Checklists** — Standard cleaning checklist per job (includes laundry: wash, dry, replace linens)
- **Invoices** — Auto-generated on job completion; print to PDF; export to CSV; QuickBooks sync
- **Documents & Media** — Photo/document uploads via Supabase Storage
- **Team** — Owner profiles (Caleb, Kennan, Mitchell) + field contractor management
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
├── index.html                          # Entire SPA (~2,900 lines)
├── supabase-schema.sql                 # Full database schema
├── vercel.json                         # Vercel SPA routing config
├── .env.example                        # Environment variable reference
└── supabase/
    └── functions/
        ├── booking-webhook/index.ts    # Auto-create jobs from bookings
        ├── quickbooks-oauth/index.ts   # Initiate QB OAuth flow
        ├── quickbooks-callback/index.ts # Handle QB OAuth callback + store tokens
        └── quickbooks-sync/index.ts    # Sync invoice to QuickBooks API
```

---

## Complete Setup Guide

### Step 1 — Supabase Project Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the entire contents of `supabase-schema.sql`
3. Go to **Database → Replication** and add the `messages` table to the publication (for real-time chat)
4. Go to **Storage** → verify the `media` bucket exists (public)
5. Note your **Project URL** and **Anon Key** from **Project Settings → API**

### Step 2 — Configure Supabase Credentials

The credentials in `index.html` (lines 334–335) are already configured for the Renovo Co. Supabase project:

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
supabase functions deploy booking-webhook
supabase functions deploy quickbooks-oauth
supabase functions deploy quickbooks-callback
supabase functions deploy quickbooks-sync
```

### Step 4 — Set Edge Function Secrets

In Supabase Dashboard → **Project Settings → Edge Functions → Add new secret**:

| Secret Name | Value |
|-------------|-------|
| `SUPABASE_SERVICE_ROLE_KEY` | From Project Settings → API (service_role key) |
| `QUICKBOOKS_CLIENT_ID` | From developer.intuit.com → your app → Keys & OAuth |
| `QUICKBOOKS_CLIENT_SECRET` | From developer.intuit.com → your app → Keys & OAuth |
| `QUICKBOOKS_REDIRECT_URI` | `https://qofwwztuykerlcxfuutv.supabase.co/functions/v1/quickbooks-callback` |
| `APP_URL` | Your Vercel deployment URL (e.g. `https://renovo-co.vercel.app`) |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are automatically available in edge functions.

### Step 5 — Deploy to Vercel

**Option A: GitHub Integration (recommended)**
1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. No build settings needed — Vercel detects the static site automatically
4. Deploy

**Option B: Vercel CLI**
```bash
npm i -g vercel
vercel --prod
```

The `vercel.json` handles SPA routing so all paths serve `index.html`.

### Step 6 — Create User Accounts

In Supabase Dashboard → **Authentication → Users → Invite User**:

| Name | Suggested Email | Role |
|------|----------------|------|
| Caleb Gabbert | caleb@renovoco.com | admin |
| Kennan Dowling | kennan@renovoco.com | admin |
| Mitchell | mitchell@renovoco.com | admin |

After users accept their invitations and log in, update their profile names:

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
Authorization: Bearer YOUR-SUPABASE-SERVICE-ROLE-KEY
Content-Type: application/json
```

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
3. Creates a full 28-item checklist (including laundry tasks)
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
4. Set the 5 secrets in Supabase Edge Functions (Step 4 above)
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
| `QUICKBOOKS_CLIENT_ID` | Edge function secrets | developer.intuit.com → Your App |
| `QUICKBOOKS_CLIENT_SECRET` | Edge function secrets | developer.intuit.com → Your App |
| `QUICKBOOKS_REDIRECT_URI` | Edge function secrets | Set to Supabase functions callback URL |
| `APP_URL` | Edge function secrets | Your Vercel deployment URL |

---

## Automation Summary

| Trigger | Auto Action |
|---------|------------|
| Booking confirmed (webhook or CRM) | Creates cleaning job for checkout date + 28-item checklist |
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
