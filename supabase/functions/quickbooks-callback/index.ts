// ============================================================
// Renovo Co. — QuickBooks OAuth Callback Handler
// Supabase Edge Function (Deno runtime)
//
// Deploy: supabase functions deploy quickbooks-callback
//
// This is the OAuth redirect URI. QuickBooks redirects here with
// an authorization code, which we exchange for access + refresh tokens.
// After storing tokens, we redirect back to the main app.
//
// Required env vars:
//   QUICKBOOKS_CLIENT_ID
//   QUICKBOOKS_CLIENT_SECRET
//   QUICKBOOKS_REDIRECT_URI  (must match what's registered in QB Developer portal)
//   APP_URL                  (e.g. https://your-app.vercel.app)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Restrict to the deployed app origin rather than '*', matching the other QB
// edge functions. Falls back to '*' only if APP_URL isn't configured yet.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error');

  const appUrl = Deno.env.get('APP_URL') || 'https://renovo-co-archive.vercel.app';

  // Handle errors from QB
  if (error) {
    const errDesc = url.searchParams.get('error_description') || error;
    return Response.redirect(`${appUrl}?qb_error=${encodeURIComponent(errDesc)}`);
  }

  if (!code || !realmId) {
    return Response.redirect(`${appUrl}?qb_error=Missing+code+or+realmId`);
  }

  const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
  const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');
  const redirectUri = Deno.env.get('QUICKBOOKS_REDIRECT_URI');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!clientId || !clientSecret || !redirectUri || !serviceRoleKey) {
    return Response.redirect(`${appUrl}?qb_error=Server+configuration+error`);
  }

  // ── Validate OAuth state server-side ──────────────────────────
  // quickbooks-oauth (admin-only) persists the state it issued to
  // integration_tokens. Require an exact, unexpired, one-time match here
  // before touching QB's token endpoint or storing anything — this is what
  // actually stops someone from completing their own QB authorization
  // against our public callback URL and hijacking the connection, since the
  // client-side sessionStorage check alone can't prevent that.
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const { data: pendingState } = await supabaseAdmin
    .from('integration_tokens')
    .select('id, oauth_state, oauth_state_created_at')
    .eq('service', 'quickbooks')
    .maybeSingle();

  const stateAgeMs = pendingState?.oauth_state_created_at
    ? Date.now() - new Date(pendingState.oauth_state_created_at).getTime()
    : Infinity;
  const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

  if (!state || !pendingState?.oauth_state || pendingState.oauth_state !== state || stateAgeMs > STATE_TTL_MS) {
    return Response.redirect(`${appUrl}?qb_error=${encodeURIComponent('Invalid or expired OAuth state (possible CSRF) — please reconnect QuickBooks')}`);
  }

  // Consume the state immediately so it can't be replayed
  const { error: consumeErr } = await supabaseAdmin.from('integration_tokens').update({ oauth_state: null, oauth_state_created_at: null }).eq('id', pendingState.id);

  if (consumeErr) {
    console.error('Failed to consume QB OAuth state:', consumeErr);
    return Response.redirect(`${appUrl}?qb_error=${encodeURIComponent('Failed to validate OAuth state — please reconnect QuickBooks')}`);
  }

  // Exchange authorization code for access + refresh tokens
  const tokenEndpoint = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
  const credentials = btoa(`${clientId}:${clientSecret}`);

  let tokenData: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  };

  try {
    const tokenRes = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('QB token exchange failed:', errBody);
      return Response.redirect(`${appUrl}?qb_error=Token+exchange+failed`);
    }

    tokenData = await tokenRes.json();
  } catch (err) {
    console.error('Token exchange error:', err);
    return Response.redirect(`${appUrl}?qb_error=Network+error+during+token+exchange`);
  }

  // Store tokens in Supabase (service role; state already validated above)
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  const tokenRecord = {
    service: 'quickbooks',
    realm_id: realmId,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: expiresAt,
    updated_at: now,
  };

  const { error: storeErr } = await supabaseAdmin.from('integration_tokens').update(tokenRecord).eq('id', pendingState.id);

  if (storeErr) {
    console.error('Failed to store QB tokens:', storeErr);
    return Response.redirect(`${appUrl}?qb_error=Failed+to+store+QuickBooks+tokens`);
  }

  // Log the connection (non-fatal if this fails)
  const { error: logErr } = await supabaseAdmin.from('activity_log').insert({
    description: `QuickBooks connected via OAuth — Realm ID: ${realmId}`,
    type: 'integration',
    created_at: now,
  });
  if (logErr) console.error('quickbooks-callback: failed to log activity', logErr);

  // Redirect back to app with success indicator.
  // The state value is NOT echoed back — it was a one-time CSRF token that was
  // already consumed server-side and is now invalid. Including it in the URL
  // would expose it in browser history, server logs, and Referer headers.
  const redirectParams = new URLSearchParams({ qb_connected: '1', realm: realmId });
  return Response.redirect(`${appUrl}?${redirectParams.toString()}`);
});
