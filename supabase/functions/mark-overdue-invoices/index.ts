// Daily cron: mark invoices overdue when due_date < today.
// Deploy: supabase functions deploy mark-overdue-invoices --no-verify-jwt
// Schedule via Supabase Dashboard → Database → Extensions → pg_cron:
//   SELECT cron.schedule('mark-overdue-invoices','0 6 * * *',
//     $$SELECT net.http_post(
//       url := 'https://qofwwztuykerlcxfuutv.supabase.co/functions/v1/mark-overdue-invoices',
//       headers := '{"Authorization":"Bearer <SUPABASE_ANON_KEY>"}'::jsonb
//     )$$
//   );

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
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

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // Auth: accept either the anon key (pg_cron scheduled calls) or a valid admin user session (admin UI).
  // This endpoint is deployed --no-verify-jwt so Supabase's gateway skips JWT validation;
  // we enforce it here to prevent anonymous public callers from triggering a DB write.
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let authorized = false;
  if (token && anonKey && token === anonKey) {
    authorized = true; // pg_cron caller
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

    const { error, count } = await sb
      .from('invoices')
      .update({ status: 'overdue', updated_at: new Date().toISOString() })
      .eq('status', 'pending')
      .lt('due_date', today)
      .select('id', { count: 'exact', head: true });

    if (error) throw error;

    // Log activity
    await sb.from('activity_log').insert({
      description: `Auto-marked ${count ?? 0} invoice(s) overdue (scheduled cron)`,
      type: 'invoice',
      created_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ marked_overdue: count ?? 0, date: today }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('mark-overdue-invoices error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
