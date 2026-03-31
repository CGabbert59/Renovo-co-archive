# Renovo Co. — Internal CRM & Operations Platform

Production-ready internal CRM for Renovo Co., an Airbnb cleaning and staging company based in Abilene, TX.

---

## Features

- **Dashboard** — KPI stats, pending jobs, upcoming schedule, activity feed
- **Jobs** — Full workflow: pending → assigned → in progress → complete, with auto-pricing
- **Calendar** — Month view of all scheduled jobs
- **Properties** — Property management with access notes (door codes, lockbox, parking)
- **Clients** — Property owner management
- **Bookings** — Airbnb, VRBO, Booking.com, and direct bookings with auto-job creation
- **Checklists** — Standard cleaning checklist per job (includes laundry: wash, dry, replace linens)
- **Invoices** — Auto-generated on job completion, manual creation, QuickBooks sync tracking
- **Documents & Media** — Photo/document uploads via Supabase Storage
- **Team** — Owner profiles + field contractor management
- **Messages** — Internal team chat
- **Integrations** — QuickBooks connection, booking platform setup guides, webhook docs

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
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **Deployment**: Vercel (static hosting)
- **Integrations**: QuickBooks Online, booking platform webhooks

---

## Deployment

### 1. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `supabase-schema.sql`
3. Go to **Storage** → verify the `media` bucket was created (public)
4. Note your project URL and anon key from **Project Settings → API**

### 2. Configure Supabase Credentials in index.html

Update lines 315–316 in `index.html`:
```javascript
const SUPABASE_URL = 'https://YOUR-PROJECT-ID.supabase.co';
const SUPABASE_KEY = 'YOUR-ANON-KEY';
```

### 3. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy from the project root
vercel --prod
```

Or connect your GitHub repo in the Vercel dashboard. The `vercel.json` file handles SPA routing automatically.

### 4. Create User Accounts

In your Supabase Dashboard → **Authentication → Users → Invite User**:

| Name | Email | Role |
|------|-------|------|
| Caleb Gabbert | caleb@renovoco.com | admin |
| Kennan Dowling | kennan@renovoco.com | admin |
| Mitchell | mitchell@renovoco.com | admin |

Then update their profiles in **SQL Editor**:
```sql
-- After users have signed up, find their UUIDs in auth.users, then:
UPDATE profiles SET full_name = 'Caleb Gabbert', role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'caleb@renovoco.com');

UPDATE profiles SET full_name = 'Kennan Dowling', role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'kennan@renovoco.com');

UPDATE profiles SET full_name = 'Mitchell', role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'mitchell@renovoco.com');
```

---

## Booking Webhook Setup

The booking webhook Edge Function auto-creates bookings and cleaning jobs from platform notifications.

### Deploy the Edge Function

```bash
# Install Supabase CLI
npm install -g supabase

# Login and link to your project
supabase login
supabase link --project-ref YOUR-PROJECT-REF

# Deploy the function
supabase functions deploy booking-webhook
```

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

When `status` is `"confirmed"`, the function automatically:
1. Creates/updates the booking record (deduplicates by `platform + external_booking_id`)
2. Creates a cleaning job scheduled for the checkout date
3. Creates a full checklist (including laundry tasks)
4. Logs the activity

### Platform Integration Options

**Airbnb** (no public API):
- Use Zapier/Make: "New Airbnb Booking" trigger → POST to webhook
- Or use a channel manager (Hospitable, Lodgify, Guesty)

**VRBO**:
- Use VRBO iCal URL + Zapier calendar trigger → POST to webhook
- Or use VRBO Connectivity API (requires partner access)

**Booking.com**:
- Use Booking.com Connectivity API or a channel manager

---

## QuickBooks Setup

1. Create an app at [developer.intuit.com](https://developer.intuit.com)
2. Set OAuth 2.0 Redirect URI to your app URL
3. Note your **Client ID**, **Client Secret**, and **Company (Realm) ID**
4. In the app, go to **Integrations → Connect QB**
5. Enter your Company ID and Access Token

### Environment Variables (for Vercel)

Set these in Vercel → Project Settings → Environment Variables:

```
QUICKBOOKS_CLIENT_ID=your-client-id
QUICKBOOKS_CLIENT_SECRET=your-client-secret
QUICKBOOKS_REDIRECT_URI=https://your-app.vercel.app/integrations
```

---

## Environment Variables Reference

| Variable | Where to Find |
|----------|--------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (secret) |
| `QUICKBOOKS_CLIENT_ID` | developer.intuit.com → Your App |
| `QUICKBOOKS_CLIENT_SECRET` | developer.intuit.com → Your App |
| `QUICKBOOKS_REDIRECT_URI` | Your Vercel app URL + `/integrations` |
| `BOOKING_API_KEY` | Self-generated secure token for webhook auth |

---

## Repository Structure

```
/
├── index.html              # Entire SPA application (~2,500 lines)
├── supabase-schema.sql     # Full database schema — run in Supabase SQL Editor
├── vercel.json             # Vercel SPA routing config
├── .env.example            # Environment variable template
└── supabase/
    └── functions/
        └── booking-webhook/
            └── index.ts    # Deno Edge Function for booking platform webhooks
```

---

## Local Development

No build step required. Just open `index.html` in a browser, or use a local server:

```bash
# Using Python
python3 -m http.server 3000

# Using Node.js
npx serve .
```

The app connects directly to Supabase — credentials are embedded in `index.html`.
