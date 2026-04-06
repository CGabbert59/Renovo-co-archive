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
// Auth: Include your Supabase service role key as Bearer token
//   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
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
  let base = 80;
  if (bedrooms >= 4) {
    base = 230; // 4+ bedroom negotiated rate
  } else {
    base += bedrooms * 30;
    base += bathrooms * 20;
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
  { category: 'Kitchen', task: 'Clean microwave inside and out', sort_order: 3 },
  { category: 'Kitchen', task: 'Wipe down all appliances', sort_order: 4 },
  { category: 'Kitchen', task: 'Clean and sanitize sink', sort_order: 5 },
  { category: 'Kitchen', task: 'Empty and clean trash can', sort_order: 6 },
  { category: 'Kitchen', task: 'Restock dish soap and paper towels', sort_order: 7 },
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
  { category: 'Laundry', task: 'Wash all linens and towels', sort_order: 1 },
  { category: 'Laundry', task: 'Dry linens and towels', sort_order: 2 },
  { category: 'Laundry', task: 'Replace linens on all beds', sort_order: 3 },
  { category: 'Laundry', task: 'Fold and place fresh towels', sort_order: 4 },
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

  // Validate auth — caller must send the Supabase service role key
  const authHeader = req.headers.get('Authorization');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
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

  // Initialize Supabase client with service role (bypass RLS)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey!);

  const now = new Date().toISOString();

  // ── 1. Upsert booking (unique constraint: platform + external_booking_id) ──
  const bookingPayload = {
    property_id,
    guest_name,
    guest_email: guest_email || null,
    platform,
    check_in: new Date(check_in as string).toISOString(),
    check_out: check_out ? new Date(check_out).toISOString() : null,
    total_amount: total_amount || null,
    guests_count,
    external_booking_id: external_booking_id || null,
    status,
    notes: notes || null,
    updated_at: now,
  };

  let bookingId: string;

  if (external_booking_id) {
    // Try to find existing booking by platform + external ID
    const { data: existing } = await supabase
      .from('bookings')
      .select('id')
      .eq('platform', platform)
      .eq('external_booking_id', external_booking_id)
      .maybeSingle();

    if (existing?.id) {
      // Update existing booking
      const { error: updateErr } = await supabase
        .from('bookings')
        .update({ ...bookingPayload })
        .eq('id', existing.id);
      if (updateErr) {
        return new Response(JSON.stringify({ error: 'Failed to update booking: ' + updateErr.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      bookingId = existing.id;
    } else {
      // Insert new booking
      const { data: inserted, error: insertErr } = await supabase
        .from('bookings')
        .insert({ ...bookingPayload, created_at: now })
        .select()
        .single();
      if (insertErr) {
        return new Response(JSON.stringify({ error: 'Failed to create booking: ' + insertErr.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      bookingId = inserted.id;
    }
  } else {
    // No external ID — always insert
    const { data: inserted, error: insertErr } = await supabase
      .from('bookings')
      .insert({ ...bookingPayload, created_at: now })
      .select()
      .single();
    if (insertErr) {
      return new Response(JSON.stringify({ error: 'Failed to create booking: ' + insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    bookingId = inserted.id;
  }

  // ── 2. Auto-create cleaning job if booking is confirmed ──
  let jobId: string | null = null;

  if (status === 'confirmed') {
    // Check if a job already exists for this booking
    const { data: existingJob } = await supabase
      .from('jobs')
      .select('id')
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (!existingJob) {
      // Get property details for pricing
      const { data: prop } = await supabase
        .from('properties')
        .select('bedrooms, bathrooms, name')
        .eq('id', property_id)
        .single();

      if (prop) {
        const beds = prop.bedrooms || 1;
        const baths = prop.bathrooms || 1;
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

        // Schedule clean for checkout date (or today if not provided)
        const cleanDate = check_out
          ? new Date(check_out).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

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
            await supabase.from('checklist_items').insert(items);
          }

          // ── 4. Log the activity ──
          await supabase.from('activity_log').insert({
            description: `Webhook: Auto-created cleaning job for ${prop.name} — checkout ${cleanDate} (${platform})`,
            type: 'job',
            created_at: now,
          });
        }
      }
    }
  }

  // ── 5. Return success ──
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
