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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  if (supabaseUrl && anonKey) {
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
  }

  const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
  const redirectUri = Deno.env.get('QUICKBOOKS_REDIRECT_URI');

  if (!clientId || !redirectUri) {
    return new Response(
      JSON.stringify({ error: 'QUICKBOOKS_CLIENT_ID and QUICKBOOKS_REDIRECT_URI must be set in environment variables.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Generate a random state value to prevent CSRF
  const state = crypto.randomUUID();

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
