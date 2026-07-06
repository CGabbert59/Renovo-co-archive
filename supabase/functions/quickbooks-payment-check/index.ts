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

// Restrict to the deployed app origin rather than '*' — this function is only
// ever called via fetch() from our own SPA with the caller's session token, so
// a wildcard origin would let any third-party page that obtained a token (via
// some other vulnerability) read the response cross-origin. Falls back to '*'
// only if APP_URL isn't configured yet, so this can't brick a fresh deploy.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || '*',
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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!serviceRoleKey || !anonKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration — SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY not set' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

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

  // Only admins may check QuickBooks payment status (matches the Invoices page being admin-only in the UI)
  const { data: callerProfile } = await userSupabase.from('profiles').select('role').eq('id', user.id).single();
  if (callerProfile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden — admin role required' }), {
      status: 403,
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

  const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
  const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');

  if (expiresAt && now >= expiresAt && token.refresh_token) {
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration — QUICKBOOKS_CLIENT_ID or QUICKBOOKS_CLIENT_SECRET not set' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
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

      if (!refreshRes.ok) {
        return new Response(JSON.stringify({ error: 'Token refresh failed: ' + (await refreshRes.text()) }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const refreshData = await refreshRes.json();
      accessToken = refreshData.access_token;
      const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
      const { error: persistErr } = await supabase.from('integration_tokens').update({
        access_token: accessToken,
        refresh_token: refreshData.refresh_token || token.refresh_token,
        expires_at: newExpiry,
        updated_at: now.toISOString(),
      }).eq('id', token.id);
      if (persistErr) {
        return new Response(JSON.stringify({ error: 'Token refresh succeeded but failed to persist new token: ' + persistErr.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Token refresh failed: ' + String(err) }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Get all QB-synced invoices that aren't paid yet.
  // Exclude placeholder IDs (starting with 'QB-') which are not real QuickBooks invoice IDs.
  const { data: invoices, error: invoicesErr } = await supabase
    .from('invoices')
    .select('id, invoice_number, quickbooks_invoice_id, status, notes')
    .not('quickbooks_invoice_id', 'is', null)
    .not('quickbooks_invoice_id', 'like', 'QB-%')
    .neq('status', 'paid');

  if (invoicesErr) {
    return new Response(JSON.stringify({ error: 'Failed to load invoices: ' + invoicesErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

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

      if (qbInv) {
        const total = parseFloat(qbInv.TotalAmt);
        const balance = parseFloat(qbInv.Balance);

        if (isNaN(total) || isNaN(balance)) {
          errors.push(`Invoice ${inv.invoice_number}: QB returned a non-numeric TotalAmt/Balance`);
          continue;
        }

        if (balance === 0 && qbInv.PrivateNote !== 'Voided') {
          // Fully paid — exclude Voided invoices which also have Balance=0 but
          // were never actually settled (voiding clears the balance without payment)
          const { error: paidErr } = await supabase.from('invoices').update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', inv.id);

          if (paidErr) {
            console.error(`Failed to mark invoice ${inv.invoice_number} paid:`, paidErr);
            errors.push(`Invoice ${inv.invoice_number}: failed to record payment — ${paidErr.message}`);
            continue;
          }

          const { error: logErr } = await supabase.from('activity_log').insert({
            description: `Invoice ${inv.invoice_number} marked paid via QuickBooks sync`,
            type: 'invoice',
            created_at: new Date().toISOString(),
          });
          if (logErr) console.error(`Failed to log activity for invoice ${inv.invoice_number} payment:`, logErr);

          updated++;
        } else if (balance < total && inv.status !== 'paid') {
          // Partially paid — update note but avoid duplicating on repeated checks
          const paid = total - balance;
          const partialNote = `Partial payment received: $${paid.toFixed(2)} of $${total.toFixed(2)} paid (QB balance: $${balance.toFixed(2)})`;
          const existingNotes = (inv as { notes?: string }).notes ?? '';
          const alreadyNoted = existingNotes.includes('Partial payment received:');
          const previousPartialLine = alreadyNoted ? existingNotes.match(/Partial payment received:[^\n]*/)?.[0] : null;
          const updatedNotes = alreadyNoted
            ? existingNotes.replace(/Partial payment received:[^\n]*/g, partialNote)
            : existingNotes ? `${existingNotes}\n${partialNote}` : partialNote;
          const { error: noteErr } = await supabase.from('invoices').update({
            notes: updatedNotes,
            updated_at: new Date().toISOString(),
          }).eq('id', inv.id);

          if (noteErr) {
            console.error(`Failed to record partial payment note for invoice ${inv.invoice_number}:`, noteErr);
            errors.push(`Invoice ${inv.invoice_number}: failed to record partial payment note — ${noteErr.message}`);
            continue;
          }

          // Only log when the partial amount actually changed since the last
          // check — otherwise clicking "Sync Payments" while the QB balance is
          // unchanged appends a duplicate activity_log entry every time.
          if (previousPartialLine !== partialNote) {
            const { error: logErr } = await supabase.from('activity_log').insert({
              description: `Invoice ${inv.invoice_number} partial payment $${paid.toFixed(2)} / $${total.toFixed(2)} (via QuickBooks)`,
              type: 'invoice',
              created_at: new Date().toISOString(),
            });
            if (logErr) console.error(`Failed to log activity for invoice ${inv.invoice_number} partial payment:`, logErr);
          }
        }
      }
    } catch (e: unknown) {
      errors.push(`Invoice ${inv.invoice_number}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  // If every single invoice check failed against QuickBooks (e.g. the access
  // token is bad or QB is down), the response previously still said
  // success: true with a cheerful "no new payments found" — indistinguishable
  // from a clean run with nothing new, even though nothing was actually
  // checked successfully. The UI's error handling keys off result.error, so
  // surface that here when nothing succeeded.
  const allFailed = invoices.length > 0 && errors.length === invoices.length && updated === 0;

  return new Response(
    JSON.stringify({
      success: !allFailed,
      updated,
      checked: invoices.length,
      errors: errors.length > 0 ? errors : undefined,
      error: allFailed ? `All ${invoices.length} invoice check(s) failed against QuickBooks: ${errors.join('; ')}` : undefined,
      message: allFailed
        ? `Failed to check ${invoices.length} invoice${invoices.length > 1 ? 's' : ''} against QuickBooks.`
        : updated > 0
        ? `${updated} invoice${updated > 1 ? 's' : ''} marked paid from QuickBooks.${errors.length > 0 ? ` (${errors.length} check(s) failed — see errors)` : ''}`
        : `Checked ${invoices.length} invoice${invoices.length > 1 ? 's' : ''} — no new payments found.${errors.length > 0 ? ` (${errors.length} check(s) failed — see errors)` : ''}`,
    }),
    {
      status: allFailed ? 502 : 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
