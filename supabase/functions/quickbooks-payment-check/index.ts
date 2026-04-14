// ============================================================
// Renovo Co. — QuickBooks Payment Check Edge Function
// Supabase Edge Function (Deno runtime)
//
// Deploy: supabase functions deploy quickbooks-payment-check
//
// Checks QuickBooks for payment status on all synced invoices
// and marks paid invoices in the local database.
// Called from the CRM "⇄ QB Payments" button.
//
// Auth: User session Bearer token (Supabase anon key with session)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Validate user session ────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized — valid session required' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Verify the token belongs to an authenticated Supabase user
  const userSupabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userSupabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized — invalid or expired session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Use service role to bypass RLS for token and invoice updates
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Load QuickBooks token
  const { data: token, error: tokenErr } = await supabase
    .from('integration_tokens')
    .select('*')
    .eq('service', 'quickbooks')
    .maybeSingle();

  if (tokenErr || !token?.realm_id || !token?.access_token) {
    return new Response(JSON.stringify({ error: 'QuickBooks not connected. Connect QB first.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Auto-refresh token if expired
  let accessToken = token.access_token;
  const now = new Date();
  const expiresAt = token.expires_at ? new Date(token.expires_at) : null;

  if (expiresAt && now >= expiresAt && token.refresh_token) {
    const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID')!;
    const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET')!;
    const credentials = btoa(`${clientId}:${clientSecret}`);

    try {
      const refreshRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: token.refresh_token,
        }).toString(),
      });

      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        accessToken = refreshData.access_token;
        const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
        await supabase.from('integration_tokens').update({
          access_token: accessToken,
          refresh_token: refreshData.refresh_token || token.refresh_token,
          expires_at: newExpiry,
          updated_at: now.toISOString(),
        }).eq('id', token.id);
      }
    } catch {
      // Continue with existing token
    }
  }

  // Get all QB-synced invoices that aren't paid yet
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, quickbooks_invoice_id, status')
    .not('quickbooks_invoice_id', 'is', null)
    .neq('status', 'paid');

  if (!invoices || invoices.length === 0) {
    return new Response(JSON.stringify({ success: true, updated: 0, message: 'No QB-synced invoices pending payment.' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const inv of invoices) {
    try {
      const qbRes = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${token.realm_id}/invoice/${inv.quickbooks_invoice_id}?minorversion=65`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );

      if (!qbRes.ok) {
        errors.push(`Invoice ${inv.invoice_number}: QB API returned ${qbRes.status}`);
        continue;
      }

      const qbData = await qbRes.json();
      const qbInv = qbData?.Invoice;

      // Invoice is fully paid if Balance === 0 and TotalAmt > 0
      if (qbInv && parseFloat(qbInv.Balance) === 0 && parseFloat(qbInv.TotalAmt) > 0) {
        await supabase.from('invoices').update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', inv.id);

        await supabase.from('activity_log').insert({
          description: `Invoice ${inv.invoice_number} marked paid via QuickBooks sync`,
          type: 'invoice',
          created_at: new Date().toISOString(),
        });

        updated++;
      }
    } catch (e: unknown) {
      errors.push(`Invoice ${inv.invoice_number}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      updated,
      checked: invoices.length,
      errors: errors.length > 0 ? errors : undefined,
      message: updated > 0
        ? `${updated} invoice${updated > 1 ? 's' : ''} marked paid from QuickBooks.`
        : `Checked ${invoices.length} invoice${invoices.length > 1 ? 's' : ''} — no new payments found.`,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
