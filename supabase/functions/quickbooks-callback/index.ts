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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const error = url.searchParams.get('error');

  const appUrl = Deno.env.get('APP_URL') || 'https://renovo-co.vercel.app';

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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!clientId || !clientSecret || !redirectUri) {
    return Response.redirect(`${appUrl}?qb_error=Server+configuration+error`);
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

  // Store tokens in Supabase (using service role to bypass RLS)
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  const { data: existing } = await supabase
    .from('integration_tokens')
    .select('id')
    .eq('service', 'quickbooks')
    .maybeSingle();

  const tokenRecord = {
    service: 'quickbooks',
    realm_id: realmId,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: expiresAt,
    updated_at: now,
  };

  if (existing?.id) {
    await supabase.from('integration_tokens').update(tokenRecord).eq('id', existing.id);
  } else {
    await supabase.from('integration_tokens').insert({ ...tokenRecord, created_at: now });
  }

  // Log the connection
  await supabase.from('activity_log').insert({
    description: `QuickBooks connected via OAuth — Realm ID: ${realmId}`,
    type: 'integration',
    created_at: now,
  });

  // Redirect back to app with success indicator
  return Response.redirect(`${appUrl}?qb_connected=1&realm=${realmId}`);
});
