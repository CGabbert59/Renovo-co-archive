# Renovo Co. — Internal CRM & Operations Platform

Production-ready internal CRM for Renovo Co., an Airbnb cleaning and staging company based in Abilene, TX.

---

## Features

- **Dashboard** — KPI stats, pending jobs, upcoming schedule, live activity feed
- **Jobs** — Full workflow: pending → assigned → in progress → complete, with auto-pricing
- **Calendar** — Month view of all scheduled jobs
- **Properties** — Property management with access notes (door codes, lockbox, parking)
- **Clients** — Property owner management
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
- Laundry required on every standard clean: Wash → Dry → Replace linens

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
├── index.html                          # Entire SPA (~2,700 lines)
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

Update lines 333–334 in `index.html` with your project's values:

```javascript
const SUPABASE_URL = 'https://YOUR-PROJECT-ID.supabase.co';
const SUPABASE_KEY = 'YOUR-ANON-KEY';
```

The anon key is intentionally public — it's safe to embed because Supabase Row Level Security protects your data.

### Step 3 — Deploy Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project (find ref in Supabase Dashboard → Project Settings → General)
supabase link --project-ref YOUR-PROJECT-REF

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
| `SUPABASE_SERVICE_ROLE_KEY` | From Project Settings → API (secret key) |
| `QUICKBOOKS_CLIENT_ID` | From developer.intuit.com → your app |
| `QUICKBOOKS_CLIENT_SECRET` | From developer.intuit.com → your app |
| `QUICKBOOKS_REDIRECT_URI` | `https://YOUR-PROJECT-ID.supabase.co/functions/v1/quickbooks-callback` |
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

## QuickBooks Integration Setup

### Step 1 — Create a QB Developer App

1. Go to [developer.intuit.com](https://developer.intuit.com/app/developer/appdetail)
2. Sign in with your QuickBooks/Intuit account
3. Click **Create an app** → Select **QuickBooks Online and Payments**
4. Go to **Keys & OAuth** → copy your **Client ID** and **Client Secret**
5. Under **Redirect URIs** → add: `https://YOUR-PROJECT-ID.supabase.co/functions/v1/quickbooks-callback`

### Step 2 — Set Secrets (see Step 4 above)

### Step 3 — Connect in the App

1. Log into the CRM
2. Go to **Integrations → Connect QB**
3. Click **Connect with QuickBooks**
4. You'll be redirected to Intuit's login page
5. Authorize the app — you'll be redirected back with QB connected

### Step 4 — Sync Invoices

1. Go to **Invoices**
2. Click **View** on any invoice
3. Click **Sync to QB** — the invoice is created in QuickBooks Online

The sync edge function handles:
- Automatic token refresh when access tokens expire
- Creating/finding the QB customer for the invoice
- Creating the QB invoice with proper line items
- Updating our invoice record with the QB invoice ID

---

## Booking Webhook Setup

The booking webhook auto-creates bookings and cleaning jobs from platform notifications.

### Webhook Endpoint

```
POST https://YOUR-PROJECT-ID.supabase.co/functions/v1/booking-webhook
Authorization: Bearer YOUR-SUPABASE-SERVICE-ROLE-KEY
Content-Type: application/json
```

### Payload Format

```json
{
  "platform": "airbnb",
  "external_booking_id": "HM123456",
  "property_id": "your-property-uuid-from-crm",
  "guest_name": "John Smith",
  "guest_email": "john@example.com",
  "check_in": "2026-04-15T16:00:00Z",
  "check_out": "2026-04-18T11:00:00Z",
  "total_amount": 450.00,
  "status": "confirmed",
  "guests_count": 2
}
```

When `status` is `"confirmed"`, the function automatically:
1. Creates/updates the booking (deduplicates by `platform + external_booking_id`)
2. Creates a cleaning job scheduled for the checkout date (10:00 AM)
3. Creates a full 28-item checklist including laundry tasks
4. Logs the activity

### Platform Integration Options

**Airbnb** (no public API — use one of these):
- **Zapier**: "New Airbnb Booking" trigger → HTTP POST to webhook URL
- **Make.com (Integromat)**: Airbnb → HTTP module
- **Channel Manager**: Hospitable, Lodgify, or Guesty (recommended for multi-platform)

**VRBO**:
- Use VRBO iCal feed + Zapier calendar trigger → POST to webhook
- Or use VRBO Connectivity API (requires partner access application)

**Booking.com**:
- Use Booking.com Connectivity API or a channel manager like Cloudbeds

**All platforms**: Manual booking entry in the CRM always works and auto-creates the job.

---

## Local Development

No build step required. Open `index.html` directly in a browser, or use a local server:

```bash
# Python
python3 -m http.server 3000

# Node.js
npx serve .
```

The app connects directly to your Supabase project — credentials are embedded in `index.html`.

---

## Environment Variables Reference

All secrets are set in **Supabase Dashboard → Project Settings → Edge Functions → Secrets** (not Vercel, since this is a static SPA with no server-side rendering).

| Variable | Where to Find | Used By |
|----------|--------------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | All edge functions |
| `QUICKBOOKS_CLIENT_ID` | developer.intuit.com → App → Keys & OAuth | quickbooks-oauth, quickbooks-callback |
| `QUICKBOOKS_CLIENT_SECRET` | developer.intuit.com → App → Keys & OAuth | quickbooks-callback, quickbooks-sync |
| `QUICKBOOKS_REDIRECT_URI` | `https://[project].supabase.co/functions/v1/quickbooks-callback` | quickbooks-oauth, quickbooks-callback |
| `APP_URL` | Your Vercel deployment URL | quickbooks-callback |

---

## Checklist Template

Every standard clean automatically gets these 28 tasks:

**Living Areas**: Dust, vacuum, mop, wipe switches, clean windows, empty trash  
**Kitchen**: Countertops, stove, microwave, appliances, sink, trash, restock supplies  
**Bathrooms**: Toilet, sink, shower/tub, mirror, floor, toilet paper, restock toiletries, empty trash  
**Bedrooms**: Dust, vacuum, empty trash  
**Laundry**: Wash linens, dry linens, replace linens on all beds, fold and place fresh towels  
**Final Walkthrough**: Walk through, check doors/windows locked, before/after photos, report damage
