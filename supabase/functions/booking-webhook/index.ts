// ============================================================
// Renovo Co. — Booking Webhook Edge Function
// Supabase Edge Function (Deno runtime)
//
// Deploy: supabase functions deploy booking-webhook
//
// Receives booking notifications from Airbnb (via Zapier/Make),
// VRBO (via Connectivity API or Zapier), or Booking.com.
// Upserts booking record and auto-creates cleaning job + checklist.
//
// Auth: Include BOOKING_API_KEY as Bearer token
//   Authorization: Bearer <BOOKING_API_KEY>
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ============================================================
// PRICING LOGIC (mirrors client-side calcJobPrice)
// ============================================================
function calcJobPrice(bedrooms: number, bathrooms: number, rush = false, deepClean = false) {
  const beds = Math.max(0, bedrooms || 0);
  const baths = Math.max(0, bathrooms || 0);
  let base = 80;
  if (beds >= 4) {
    base = 230; // 4+ bedroom negotiated rate
  } else {
    base += beds * 30;
    base += baths * 20;
  }
  let total = base;
  if (rush) total += 75;
  if (deepClean) total *= 2;
  return {
    base,
    total,
    rush: rush ? 75 : 0,
    deepMultiplier: deepClean ? 2 : 1,
  };
}

// ============================================================
// STANDARD CHECKLIST (mirrors STANDARD_CHECKLIST in index.html)
// ============================================================
const STANDARD_CHECKLIST = [
  // Living Areas
  { category: 'Living Areas', task: 'Dust all surfaces and furniture', sort_order: 1 },
  { category: 'Living Areas', task: 'Vacuum all floors and rugs', sort_order: 2 },
  { category: 'Living Areas', task: 'Mop hard floors', sort_order: 3 },
  { category: 'Living Areas', task: 'Wipe light switches and outlets', sort_order: 4 },
  { category: 'Living Areas', task: 'Clean windows and glass doors', sort_order: 5 },
  { category: 'Living Areas', task: 'Empty all trash cans', sort_order: 6 },
  // Kitchen
  { category: 'Kitchen', task: 'Clean and sanitize countertops', sort_order: 1 },
  { category: 'Kitchen', task: 'Clean stovetop and oven exterior', sort_order: 2 },
  { category: 'Kitchen', task: 'Clean and sanitize sink', sort_order: 3 },
  { category: 'Kitchen', task: 'Wipe down all appliances', sort_order: 4 },
  { category: 'Kitchen', task: 'Clean microwave inside and out', sort_order: 5 },
  { category: 'Kitchen', task: 'Empty and wipe out trash can', sort_order: 6 },
  { category: 'Kitchen', task: 'Restock paper towels / dish soap', sort_order: 7 },
  // Bathrooms
  { category: 'Bathrooms', task: 'Scrub and disinfect toilet', sort_order: 1 },
  { category: 'Bathrooms', task: 'Clean and polish sink and countertop', sort_order: 2 },
  { category: 'Bathrooms', task: 'Scrub shower and/or bathtub', sort_order: 3 },
  { category: 'Bathrooms', task: 'Clean mirrors', sort_order: 4 },
  { category: 'Bathrooms', task: 'Mop bathroom floor', sort_order: 5 },
  { category: 'Bathrooms', task: 'Replace toilet paper rolls', sort_order: 6 },
  { category: 'Bathrooms', task: 'Restock toiletries and soap', sort_order: 7 },
  { category: 'Bathrooms', task: 'Empty trash', sort_order: 8 },
  // Bedrooms
  { category: 'Bedrooms', task: 'Dust surfaces and nightstands', sort_order: 1 },
  { category: 'Bedrooms', task: 'Vacuum bedroom floors', sort_order: 2 },
  { category: 'Bedrooms', task: 'Empty trash cans', sort_order: 3 },
  // Laundry (REQUIRED per business rules)
  { category: 'Laundry', task: 'Wash linens', sort_order: 1 },
  { category: 'Laundry', task: 'Dry linens', sort_order: 2 },
  { category: 'Laundry', task: 'Replace linens on all beds', sort_order: 3 },
  { category: 'Laundry', task: 'Fold towels', sort_order: 4 },
  // Final Walkthrough
  { category: 'Final Walkthrough', task: 'Walk through entire property', sort_order: 1 },
  { category: 'Final Walkthrough', task: 'Check all doors and windows locked', sort_order: 2 },
  { category: 'Final Walkthrough', task: 'Take before/after photos', sort_order: 3 },
  { category: 'Final Walkthrough', task: 'Report any damage or issues', sort_order: 4 },
];

// ============================================================
// MAIN HANDLER
// ============================================================
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate auth — caller must send BOOKING_API_KEY in the Authorization header.
  // Set BOOKING_API_KEY in Supabase Dashboard → Edge Functions → Secrets.
  const authHeader = req.headers.get('Authorization');
  const bookingApiKey = Deno.env.get('BOOKING_API_KEY');
  const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  // Timing-safe comparison to prevent timing attacks
  const keyValid = (() => {
    if (!bookingApiKey || !providedKey || bookingApiKey.length !== providedKey.length) return false;
    const a = new TextEncoder().encode(bookingApiKey);
    const b = new TextEncoder().encode(providedKey);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  })();
  if (!keyValid) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const {
    platform,
    external_booking_id,
    property_id,
    guest_name,
    guest_email,
    check_in,
    check_out,
    total_amount,
    status = 'confirmed',
    guests_count = 1,
    notes,
  } = body as {
    platform: string;
    external_booking_id?: string;
    property_id: string;
    guest_name: string;
    guest_email?: string;
    check_in: string;
    check_out?: string;
    total_amount?: number;
    status?: string;
    guests_count?: number;
    notes?: string;
  };

  // Validate required fields
  if (!platform || !property_id || !guest_name || !check_in) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: platform, property_id, guest_name, check_in' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Validate platform early so we can return a clear 400 instead of a raw DB
  // constraint-violation error (bookings.platform also has a DB-level CHECK).
  const validPlatforms = ['airbnb', 'vrbo', 'booking.com', 'direct'];
  if (!validPlatforms.includes(platform)) {
    return new Response(
      JSON.stringify({ error: `Invalid platform "${platform}". Must be one of: ${validPlatforms.join(', ')}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Normalize the single-L "canceled" spelling (used by Airbnb/VRBO payloads
  // and the cancellation branch below) to the double-L value the DB's
  // bookings.status CHECK constraint actually accepts, before it's ever
  // written. Without this, a caller sending "canceled" hit a raw upsert
  // constraint-violation 500 below — the cancellation branch's own alias
  // handling was unreachable because the upsert failed first.
  const normalizedStatus = status === 'canceled' ? 'cancelled' : status;
  const validStatuses = ['confirmed', 'pending', 'cancelled'];
  if (!validStatuses.includes(normalizedStatus)) {
    return new Response(
      JSON.stringify({ error: `Invalid status "${status}". Must be one of: ${validStatuses.join(', ')} (or "canceled")` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Validate check_in/check_out are parseable before using them — an
  // unparseable date string makes Date#toISOString() throw a RangeError,
  // which would otherwise crash this function with a raw 500 instead of a
  // clean 400 a calling Zapier/Make integration could act on.
  const checkInDate = new Date(check_in as string);
  if (isNaN(checkInDate.getTime())) {
    return new Response(
      JSON.stringify({ error: `Invalid check_in date: "${check_in}"` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  let checkOutDate: Date | null = null;
  if (check_out) {
    checkOutDate = new Date(check_out);
    if (isNaN(checkOutDate.getTime())) {
      return new Response(
        JSON.stringify({ error: `Invalid check_out date: "${check_out}"` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // A same-or-earlier checkout would schedule the clean for checkInDate's
    // day or before, or — fed into "schedule clean for checkout date" below —
    // silently produce a stay-less booking. Reject it instead of writing it.
    if (checkOutDate.getTime() <= checkInDate.getTime()) {
      return new Response(
        JSON.stringify({ error: `check_out ("${check_out}") must be after check_in ("${check_in}")` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // Validate total_amount/guests_count before the upsert — both bookings
  // columns have a matching DB-level CHECK constraint (bookings_amount_nonneg,
  // bookings_guests_positive), so an invalid value here previously surfaced as
  // a raw constraint-violation 500 instead of a clean 400, same class of bug
  // the platform/status/date checks above already guard against.
  if (typeof total_amount === 'number' && total_amount < 0) {
    return new Response(
      JSON.stringify({ error: `total_amount cannot be negative: ${total_amount}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (typeof guests_count !== 'number' || guests_count < 1) {
    return new Response(
      JSON.stringify({ error: `guests_count must be a positive number: ${guests_count}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Initialize Supabase client with service role (bypass RLS)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration — SUPABASE_SERVICE_ROLE_KEY not set' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date().toISOString();

  // ── 1. Upsert booking (unique constraint: platform + external_booking_id) ──
  const bookingPayload = {
    property_id,
    guest_name,
    guest_email: guest_email || null,
    platform,
    check_in: checkInDate.toISOString(),
    check_out: checkOutDate ? checkOutDate.toISOString() : null,
    total_amount: typeof total_amount === 'number' ? total_amount : null,
    guests_count,
    external_booking_id: external_booking_id || null,
    status: normalizedStatus,
    notes: notes || null,
    updated_at: now,
  };

  let bookingId: string;

  // A true upsert keyed on the UNIQUE(platform, external_booking_id) constraint
  // avoids the select-then-insert/update race where two near-simultaneous
  // deliveries for the same external_booking_id could both pass a prior
  // existence check and collide on insert. created_at is deliberately omitted
  // from the payload so it keeps its table default (NOW()) on first insert and
  // is left untouched (not overwritten) on a conflict update. When
  // external_booking_id is null, Postgres never matches it against the unique
  // constraint, so this always inserts a fresh row — same as before.
  const { data: upserted, error: upsertErr } = await supabase
    .from('bookings')
    .upsert(bookingPayload, { onConflict: 'platform,external_booking_id' })
    .select()
    .single();
  if (upsertErr) {
    return new Response(JSON.stringify({ error: 'Failed to upsert booking: ' + upsertErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  bookingId = upserted.id;

  // ── 2. Handle booking cancellation — cancel the linked job ──
  if (normalizedStatus === 'cancelled') {
    const { data: linkedJob } = await supabase
      .from('jobs')
      .select('id, status')
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (linkedJob && !['completed', 'cancelled'].includes(linkedJob.status)) {
      const { error: cancelErr } = await supabase.from('jobs').update({ status: 'cancelled', updated_at: now }).eq('id', linkedJob.id);
      if (cancelErr) {
        console.error('Failed to cancel linked job:', cancelErr);
        return new Response(
          JSON.stringify({
            success: false,
            booking_id: bookingId,
            job_id: linkedJob.id,
            error: `Booking marked cancelled, but linked job cancellation failed: ${cancelErr.message}`,
          }),
          { status: 207, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      await supabase.from('activity_log').insert({
        description: `Booking cancelled via webhook — linked job cancelled (${platform}: ${guest_name})`,
        type: 'job',
        created_at: now,
      });
    } else if (linkedJob && linkedJob.status === 'completed') {
      // The clean already happened (and was or will be invoiced) before this
      // cancellation arrived — the job and its invoice are intentionally left
      // untouched, but flag it so an admin scanning cancelled bookings knows
      // billing still stands rather than assuming it was reversed.
      await supabase.from('activity_log').insert({
        description: `Booking cancelled via webhook after its job was already completed — job and invoice left untouched (${platform}: ${guest_name})`,
        type: 'job',
        created_at: now,
      });
    }

    return new Response(
      JSON.stringify({ success: true, booking_id: bookingId, job_id: linkedJob?.id || null, message: 'Booking marked cancelled.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ── 3. Auto-create cleaning job if booking is confirmed ──
  let jobId: string | null = null;
  let jobCreationError: string | null = null;
  let checklistCreationError: string | null = null;

  // Schedule clean for checkout date (or check_in + 1 day if not provided) —
  // computed up front since both the create-job and reschedule-job branches
  // below need it.
  const checkoutFallback = new Date(checkInDate);
  checkoutFallback.setDate(checkoutFallback.getDate() + 1);
  const cleanDate = checkOutDate
    ? checkOutDate.toISOString().split('T')[0]
    : checkoutFallback.toISOString().split('T')[0];

  if (normalizedStatus === 'confirmed') {
    // Check if a non-cancelled job already exists for this booking
    const { data: existingJob } = await supabase
      .from('jobs')
      .select('id, status, scheduled_date')
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (!existingJob || existingJob.status === 'cancelled') {
      // Get property details for pricing — fail fast if property_id is invalid
      const { data: prop, error: propErr } = await supabase
        .from('properties')
        .select('bedrooms, bathrooms, name')
        .eq('id', property_id)
        .single();

      if (propErr || !prop) {
        return new Response(
          JSON.stringify({ error: `Property not found: ${property_id}` }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (prop) {
        const beds = prop.bedrooms ?? 1;
        const baths = prop.bathrooms ?? 1;
        const p = calcJobPrice(beds, baths, false, false);

        // Separate charges for proper breakdown display
        let base = 80;
        let bedCharge = 0;
        let bathCharge = 0;
        if (beds >= 4) {
          base = 230;
        } else {
          bedCharge = beds * 30;
          bathCharge = baths * 20;
        }

        const { data: newJob, error: jobErr } = await supabase
          .from('jobs')
          .insert({
            property_id,
            booking_id: bookingId,
            job_type: 'standard',
            status: 'pending',
            scheduled_date: cleanDate,
            scheduled_time: '10:00',
            base_price: base,
            bedroom_charge: bedCharge,
            bathroom_charge: bathCharge,
            rush_charge: 0,
            deep_clean_multiplier: 1,
            total_price: p.total,
            auto_generated: true,
            notes: `Auto-created from ${platform} booking: ${guest_name}`,
            created_at: now,
          })
          .select()
          .single();

        if (!jobErr && newJob) {
          jobId = newJob.id;

          // ── 3. Auto-create checklist for the job ──
          const { data: checklist, error: clErr } = await supabase
            .from('checklists')
            .insert({ job_id: jobId, status: 'pending', created_at: now })
            .select()
            .single();

          if (!clErr && checklist) {
            const items = STANDARD_CHECKLIST.map((item) => ({
              checklist_id: checklist.id,
              category: item.category,
              task: item.task,
              sort_order: item.sort_order,
              completed: false,
              created_at: now,
            }));
            const { error: itemsErr } = await supabase.from('checklist_items').insert(items);
            if (itemsErr) {
              console.error('booking-webhook: failed to create checklist items', itemsErr);
              checklistCreationError = itemsErr.message;
            }
          } else if (clErr) {
            console.error('booking-webhook: failed to create checklist', clErr);
            checklistCreationError = clErr.message;
          }

          // ── 4. Log the activity ──
          const { error: logErr } = await supabase.from('activity_log').insert({
            description: `Webhook: Auto-created cleaning job for ${prop.name} — checkout ${cleanDate} (${platform})`,
            type: 'job',
            created_at: now,
          });
          if (logErr) console.error('booking-webhook: failed to log activity', logErr);
        } else if (jobErr) {
          if (jobErr.code === '23505') {
            // Lost the race to a concurrent delivery for the same booking (e.g. a
            // Zapier retry) — jobs_booking_id_active_unique means a non-cancelled
            // job for this booking now exists, created by the winning request.
            // Re-fetch it and report success instead of a false partial-failure.
            const { data: raceJob, error: raceSelectErr } = await supabase
              .from('jobs')
              .select('id')
              .eq('booking_id', bookingId)
              .neq('status', 'cancelled')
              .maybeSingle();
            if (raceJob) {
              jobId = raceJob.id;
            } else {
              console.error('booking-webhook: unique-violation on job insert but no matching job found', raceSelectErr);
              jobCreationError = jobErr.message;
            }
          } else {
            console.error('booking-webhook: failed to create job', jobErr);
            jobCreationError = jobErr.message;
          }
        }
      }
    } else if (existingJob.status === 'pending') {
      // A re-sent confirmation for the same booking (e.g. the guest changed
      // their checkout date and the platform re-fired the webhook) previously
      // left the already-created job's scheduled_date stale, since this branch
      // only handled creating a job, not updating one. Safe to resync only
      // while the job hasn't started — an in_progress/completed job is left
      // alone below.
      jobId = existingJob.id;
      if (existingJob.scheduled_date !== cleanDate) {
        const { error: rescheduleErr } = await supabase
          .from('jobs')
          .update({ scheduled_date: cleanDate, updated_at: now })
          .eq('id', existingJob.id);
        if (rescheduleErr) {
          console.error('booking-webhook: failed to reschedule job', rescheduleErr);
        } else {
          await supabase.from('activity_log').insert({
            description: `Webhook: Rescheduled cleaning job to ${cleanDate} after booking date change (${platform}: ${guest_name})`,
            type: 'job',
            created_at: now,
          });
        }
      }
    } else {
      // in_progress or completed — already underway or done, nothing to sync.
      jobId = existingJob.id;
    }
  }

  // ── 5. Return success (or partial failure if the job/checklist couldn't be created) ──
  if (jobCreationError) {
    return new Response(
      JSON.stringify({
        success: false,
        booking_id: bookingId,
        job_id: null,
        error: `Booking upserted but job creation failed: ${jobCreationError}`,
      }),
      { status: 207, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (checklistCreationError) {
    return new Response(
      JSON.stringify({
        success: false,
        booking_id: bookingId,
        job_id: jobId,
        error: `Booking and job created, but checklist creation failed: ${checklistCreationError}`,
      }),
      { status: 207, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      booking_id: bookingId,
      job_id: jobId,
      message: jobId
        ? `Booking upserted and cleaning job created (job: ${jobId})`
        : 'Booking upserted. No job created (status not confirmed or job already exists).',
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
