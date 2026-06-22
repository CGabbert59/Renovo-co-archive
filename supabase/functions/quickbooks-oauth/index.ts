// ============================================================
// Renovo Co. — QuickBooks OAuth Initiator
// Supabase Edge Function (Deno runtime)
//
// Deploy: supabase functions deploy quickbooks-oauth
//
// Returns the QuickBooks OAuth authorization URL.
// The SPA calls this endpoint then redirects the user to QB's login.
//
// Required env vars:
//   QUICKBOOKS_CLIENT_ID
//   QUICKBOOKS_REDIRECT_URI  (e.g. https://your-project.supabase.co/functions/v1/quickbooks-callback)
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── Validate user session ────────────────────────────────────
  // OAuth initiation must come from an authenticated app user.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized — valid session required' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!anonKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration — SUPABASE_ANON_KEY not set' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized — invalid or expired session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Only admins may connect the QuickBooks integration (matches the
  // Integrations page being admin-only in the UI).
  const { data: callerProfile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (callerProfile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden — admin role required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
  const redirectUri = Deno.env.get('QUICKBOOKS_REDIRECT_URI');

  if (!clientId || !redirectUri) {
    return new Response(
      JSON.stringify({ error: 'QUICKBOOKS_CLIENT_ID and QUICKBOOKS_REDIRECT_URI must be set in environment variables.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Generate a random state value to prevent CSRF, and persist it server-side
  // so quickbooks-callback can verify the eventual redirect was the result of
  // a flow we actually issued (rather than an attacker completing the OAuth
  // dance directly against our public callback URL with their own QB account).
  const state = crypto.randomUUID();
  const stateCreatedAt = new Date().toISOString();

  const { data: existingRow } = await userClient
    .from('integration_tokens')
    .select('id')
    .eq('service', 'quickbooks')
    .maybeSingle();

  const { error: stateErr } = existingRow?.id
    ? await userClient.from('integration_tokens')
        .update({ oauth_state: state, oauth_state_created_at: stateCreatedAt })
        .eq('id', existingRow.id)
    : await userClient.from('integration_tokens')
        .insert({ service: 'quickbooks', oauth_state: state, oauth_state_created_at: stateCreatedAt });

  if (stateErr) {
    return new Response(JSON.stringify({ error: 'Failed to start OAuth flow: ' + stateErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // QuickBooks OAuth 2.0 authorization URL
  // QB provides refresh tokens automatically — access_type is not a standard QB param
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });

  const authUrl = `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;

  return new Response(
    JSON.stringify({ url: authUrl, state }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
