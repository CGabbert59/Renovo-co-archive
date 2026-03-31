// ============================================================
// Renovo Co. — Booking Webhook Edge Function
// POST /functions/v1/booking-webhook
//
// Deploy: supabase functions deploy booking-webhook
//
// Payload (JSON body):
// {
//   platform: "airbnb" | "vrbo" | "booking.com" | "direct",
//   external_booking_id: string,       // platform's booking ref (for deduplication)
//   property_id: string,               // Renovo property UUID
//   guest_name: string,
//   guest_email: string,
//   check_in: string,                  // ISO 8601
//   check_out: string,                 // ISO 8601
//   total_amount: number,
//   status: "confirmed" | "pending" | "cancelled"
// }
//
// Auth: Bearer <SUPABASE_SERVICE_ROLE_KEY> in Authorization header
//       (or use the anon key if you open up the policy)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Default checklist items (mirrors the frontend DEFAULT_CHECKLIST_ITEMS)
const DEFAULT_ITEMS = [
  {category:'Kitchen',    task:'Wipe all countertops and backsplash',     sort_order:1},
  {category:'Kitchen',    task:'Clean stovetop and hood',                  sort_order:2},
  {category:'Kitchen',    task:'Clean microwave inside and out',           sort_order:3},
  {category:'Kitchen',    task:'Clean and sanitize sink',                  sort_order:4},
  {category:'Kitchen',    task:'Wipe cabinet fronts and handles',          sort_order:5},
  {category:'Kitchen',    task:'Empty and reline trash can',               sort_order:6},
  {category:'Kitchen',    task:'Sweep and mop floor',                      sort_order:7},
  {category:'Living Room',task:'Vacuum all rugs and carpets',              sort_order:1},
  {category:'Living Room',task:'Dust all surfaces and shelves',            sort_order:2},
  {category:'Living Room',task:'Fluff and arrange pillows and throws',     sort_order:3},
  {category:'Living Room',task:'Wipe TV screen and electronics',           sort_order:4},
  {category:'Living Room',task:'Clean windows and mirrors',                sort_order:5},
  {category:'Bathrooms',  task:'Scrub and sanitize toilet (inside & out)', sort_order:1},
  {category:'Bathrooms',  task:'Clean and polish sink and faucet',         sort_order:2},
  {category:'Bathrooms',  task:'Scrub shower or bathtub',                  sort_order:3},
  {category:'Bathrooms',  task:'Replace towels with fresh clean set',      sort_order:4},
  {category:'Bathrooms',  task:'Wipe mirrors and glass surfaces',          sort_order:5},
  {category:'Bathrooms',  task:'Restock toiletries and supplies',          sort_order:6},
  {category:'Bathrooms',  task:'Sweep and mop floor',                      sort_order:7},
  {category:'Bedrooms',   task:'Make all beds with clean linens',          sort_order:1},
  {category:'Bedrooms',   task:'Dust all furniture and surfaces',          sort_order:2},
  {category:'Bedrooms',   task:'Vacuum or sweep floor',                    sort_order:3},
  {category:'Bedrooms',   task:'Wipe down nightstands and lamps',          sort_order:4},
  {category:'Bedrooms',   task:'Check closets and drawers — clear items',  sort_order:5},
  {category:'Laundry',    task:'Wash linens',                              sort_order:1},
  {category:'Laundry',    task:'Dry linens',                               sort_order:2},
  {category:'Laundry',    task:'Replace linens on all beds',               sort_order:3},
  {category:'General',    task:'Take out all trash and recyclables',       sort_order:1},
  {category:'General',    task:'Check and restock cleaning supplies',      sort_order:2},
  {category:'General',    task:'Sweep entry and porch if applicable',      sort_order:3},
  {category:'General',    task:'Final walkthrough — all rooms checked',    sort_order:4},
  {category:'General',    task:'Lock all doors and secure property',       sort_order:5},
]

function calcPrice(beds: number, baths: number): number {
  if (beds >= 4) return 230
  return 80 + (beds * 30) + (baths * 20)
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // Use service role key so we can write regardless of RLS
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const body = await req.json()
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
    } = body

    // Validate required fields
    if (!property_id || !guest_name) {
      return new Response(
        JSON.stringify({ error: 'property_id and guest_name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify property exists
    const { data: prop, error: propErr } = await sb
      .from('properties')
      .select('id, name, bedrooms, bathrooms')
      .eq('id', property_id)
      .single()

    if (propErr || !prop) {
      return new Response(
        JSON.stringify({ error: 'Property not found: ' + property_id }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── UPSERT BOOKING (deduplicate on external_booking_id) ──
    const bookingPayload = {
      property_id,
      guest_name,
      guest_email: guest_email || null,
      platform: platform || 'direct',
      check_in: check_in ? new Date(check_in).toISOString() : null,
      check_out: check_out ? new Date(check_out).toISOString() : null,
      total_amount: total_amount ?? null,
      status,
      external_booking_id: external_booking_id || null,
      updated_at: new Date().toISOString(),
    }

    let booking: Record<string, unknown> | null = null
    let isNew = true

    if (external_booking_id) {
      const { data: existing } = await sb
        .from('bookings')
        .select('*')
        .eq('external_booking_id', external_booking_id)
        .maybeSingle()

      if (existing) {
        isNew = false
        const { data: updated } = await sb
          .from('bookings')
          .update(bookingPayload)
          .eq('id', existing.id)
          .select()
          .single()
        booking = updated
      }
    }

    if (!booking) {
      const { data: inserted, error: insErr } = await sb
        .from('bookings')
        .insert(bookingPayload)
        .select()
        .single()
      if (insErr) throw new Error('Booking insert failed: ' + insErr.message)
      booking = inserted
    }

    // ── AUTO-CREATE JOB + CHECKLIST (only for new confirmed bookings) ──
    let job: Record<string, unknown> | null = null

    if (status === 'confirmed' && booking) {
      // Check if a job already exists for this booking
      const { data: existingJob } = await sb
        .from('jobs')
        .select('id')
        .eq('booking_id', booking.id as string)
        .maybeSingle()

      if (!existingJob) {
        const beds = prop.bedrooms ?? 1
        const baths = prop.bathrooms ?? 1
        const total = calcPrice(beds, baths)
        const base = beds >= 4 ? 230 : 80
        const bedCharge = beds >= 4 ? 0 : beds * 30
        const bathCharge = beds >= 4 ? 0 : baths * 20

        const schedDate = check_out
          ? new Date(check_out).toISOString().split('T')[0]
          : check_in
          ? new Date(check_in).toISOString().split('T')[0]
          : null

        const { data: newJob, error: jobErr } = await sb
          .from('jobs')
          .insert({
            property_id,
            booking_id: booking.id,
            job_type: 'standard',
            status: 'pending',
            scheduled_date: schedDate,
            scheduled_time: '10:00',
            base_price: base,
            bedroom_charge: bedCharge,
            bathroom_charge: bathCharge,
            rush_charge: 0,
            deep_clean_multiplier: 1,
            total_price: total,
            auto_generated: true,
            notes: `Auto-created via ${platform ?? 'webhook'} for ${guest_name}`,
          })
          .select()
          .single()

        if (jobErr) throw new Error('Job insert failed: ' + jobErr.message)
        job = newJob

        // Create checklist
        const { data: cl } = await sb
          .from('checklists')
          .insert({ job_id: job!.id, status: 'pending' })
          .select()
          .single()

        if (cl) {
          const items = DEFAULT_ITEMS.map(i => ({
            ...i,
            checklist_id: cl.id,
            completed: false,
          }))
          await sb.from('checklist_items').insert(items)
        }
      } else {
        job = existingJob
      }
    }

    // ── HANDLE CANCELLATION ──
    if (status === 'cancelled' && booking) {
      await sb
        .from('jobs')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('booking_id', booking.id as string)
        .eq('status', 'pending') // only cancel if not yet started
    }

    // Log activity
    await sb.from('activity_log').insert({
      action: isNew ? 'create' : 'update',
      description: `[Webhook] ${platform ?? 'Platform'} booking ${isNew ? 'received' : 'updated'} for ${guest_name} at ${prop.name} (${status})`,
    })

    return new Response(
      JSON.stringify({
        success: true,
        booking_id: booking?.id,
        job_id: job?.id ?? null,
        is_new_booking: isNew,
        action: status === 'confirmed' ? 'job_created' : status,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('booking-webhook error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
