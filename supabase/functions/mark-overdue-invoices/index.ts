// Daily cron: mark invoices overdue when due_date < today.
// Deploy: supabase functions deploy mark-overdue-invoices --no-verify-jwt
//
// RECOMMENDED SETUP (uses a dedicated CRON_SECRET, not the public anon key):
//
// STEP 1 — Generate a secret and store it in two places:
//   a) Supabase Dashboard → Project Settings → Edge Functions → Secrets:
//      CRON_SECRET = <openssl rand -hex 32>
//   b) In the Supabase SQL Editor (so pg_cron can read it at runtime):
//      ALTER DATABASE postgres SET app.cron_secret = '<same value>';
//
// STEP 2 — Schedule via Supabase SQL Editor (fires at 06:00 UTC = midnight CT):
//   SELECT cron.schedule(
//     'mark-overdue-invoices',
//     '0 6 * * *',
//     $$
//     SELECT net.http_post(
//       url     := 'https://qofwwztuykerlcxfuutv.supabase.co/functions/v1/mark-overdue-invoices',
//       headers := jsonb_build_object(
//         'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
//         'Content-Type',  'application/json'
//       ),
//       body    := '{}'::jsonb
//     )
//     $$
//   );
//
// LEGACY FALLBACK: if CRON_SECRET is not set, the anon key is still accepted so
// existing deployments keep working. Migrate to CRON_SECRET to prevent the public
// anon key (visible in index.html) from being usable as a cron auth token.
//
// Note: pg_cron and pg_net extensions must be enabled (Dashboard → Database → Extensions).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !anonKey) {
    const missing = !SUPABASE_URL ? 'SUPABASE_URL' : !SERVICE_ROLE_KEY ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_ANON_KEY';
    return new Response(JSON.stringify({ error: `Missing ${missing}` }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // Auth: accept either the CRON_SECRET (pg_cron scheduled calls, preferred),
  // the anon key (pg_cron legacy fallback — migrate to CRON_SECRET to prevent
  // the public anon key from acting as a valid cron auth token), or a valid
  // admin user session (admin UI manual trigger).
  // This endpoint is deployed --no-verify-jwt so Supabase's gateway skips JWT
  // validation; we enforce auth here to prevent unauthenticated DB writes.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let authorized = false;
  let triggerSource = 'admin manual trigger';
  if (cronSecret && token === cronSecret) {
    authorized = true;
    triggerSource = 'scheduled cron';
  } else if (!cronSecret && anonKey && token === anonKey) {
    // Legacy: CRON_SECRET not configured — fall back to anon key comparison.
    // This keeps existing pg_cron jobs working. Set CRON_SECRET (see comments
    // at top of file) to stop accepting the public anon key for cron auth.
    console.warn('mark-overdue-invoices: CRON_SECRET not set — using anon key for cron auth. Migrate to CRON_SECRET to improve security.');
    authorized = true;
    triggerSource = 'scheduled cron';
  } else if (token && anonKey) {
    try {
      const userClient = createClient(SUPABASE_URL, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const { data: profile } = await userClient.from('profiles').select('role').eq('id', user.id).single();
        if ((profile as { role?: string })?.role === 'admin') authorized = true;
      }
    } catch { /* fall through to unauthorized */ }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // Use America/Chicago (Abilene, TX) so invoices aren't marked overdue hours early
    // when an admin triggers "Run Now" in the evening local time. The scheduled cron at
    // 6 AM UTC (midnight CT) is unaffected since UTC date = CT date at that hour.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

    // .select('id') returns the updated rows so we can count them accurately.
    // head:true on an UPDATE sends a HEAD request that PostgREST ignores,
    // always yielding count:null — omit it entirely.
    // Include 'draft' to match the client-side autoMarkOverdueInvoices() target set —
    // without it the daily cron misses past-due draft invoices that the dashboard's
    // overdueCount fallback catches, creating a permanent inconsistency between the
    // cron-flipped 'overdue' status and the client-side urgency signal.
    const { data: updated, error } = await sb
      .from('invoices')
      .update({ status: 'overdue', updated_at: new Date().toISOString() })
      .in('status', ['pending', 'draft'])
      .lt('due_date', today)
      .select('id');

    if (error) throw error;

    const markedCount = (updated || []).length;

    // Log activity (non-fatal — a log failure doesn't roll back the overdue update)
    const { error: logErr } = await sb.from('activity_log').insert({
      description: `Auto-marked ${markedCount} invoice(s) overdue (${triggerSource})`,
      type: 'invoice',
      created_at: new Date().toISOString(),
    });
    if (logErr) console.error('Activity log insert failed after marking overdue:', logErr);

    return new Response(JSON.stringify({ marked_overdue: markedCount, date: today }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('mark-overdue-invoices error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
