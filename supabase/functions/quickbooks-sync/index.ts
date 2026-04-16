// ============================================================
// Renovo Co. — QuickBooks Invoice Sync
// Supabase Edge Function (Deno runtime)
//
// Deploy: supabase functions deploy quickbooks-sync
//
// Syncs a Renovo invoice to QuickBooks Online.
// Handles token refresh if access token is expired.
//
// POST /functions/v1/quickbooks-sync
// Auth: Bearer <SUPABASE_ANON_KEY> (with user session)
// Body: { invoice_id: "uuid" }
//
// Required env vars:
//   QUICKBOOKS_CLIENT_ID
//   QUICKBOOKS_CLIENT_SECRET
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// QB API base URLs
const QB_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

// ── Token Refresh ──────────────────────────────────────────────
async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return await res.json() as { access_token: string; refresh_token: string; expires_in: number };
}

// ── Get or Create QB Services Item ────────────────────────────
// Looks up a "Services" item by name; creates it if absent.
// This avoids relying on a hardcoded item ID (which varies per QB account).
async function ensureServicesItem(realmId: string, accessToken: string): Promise<string> {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Search for existing item named "Services"
  const queryRes = await fetch(
    `${QB_API_BASE}/${realmId}/query?query=${encodeURIComponent("SELECT * FROM Item WHERE Name = 'Services' AND Active = true")}&minorversion=65`,
    { headers }
  );
  if (queryRes.ok) {
    const queryData = await queryRes.json();
    const existing = queryData?.QueryResponse?.Item?.[0];
    if (existing) return String(existing.Id);
  }

  // Not found — create a simple Services item
  const createRes = await fetch(`${QB_API_BASE}/${realmId}/item?minorversion=65`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      Name: 'Services',
      Type: 'Service',
      IncomeAccountRef: { name: 'Services', value: '1' }, // Default income account
    }),
  });
  if (createRes.ok) {
    const createData = await createRes.json();
    return String(createData?.Item?.Id || '1');
  }

  // Fallback to QB default (ID 1 = Services in fresh accounts)
  return '1';
}

// ── Create/Update QB Customer ──────────────────────────────────
async function ensureQBCustomer(
  realmId: string,
  accessToken: string,
  client: { first_name: string; last_name: string; email?: string; quickbooks_customer_id?: string }
): Promise<string> {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // If we already have a QB customer ID, return it
  if (client.quickbooks_customer_id) return client.quickbooks_customer_id;

  // Search for existing customer by name (escape single quotes for SOQL safety)
  const displayName = `${client.first_name} ${client.last_name}`.trim();
  const safeName = displayName.replace(/'/g, "\\'");
  const queryRes = await fetch(
    `${QB_API_BASE}/${realmId}/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${safeName}'`)}&minorversion=65`,
    { headers }
  );
  const queryData = await queryRes.json();
  const existing = queryData?.QueryResponse?.Customer?.[0];
  if (existing) return String(existing.Id);

  // Create new customer
  const createRes = await fetch(`${QB_API_BASE}/${realmId}/customer?minorversion=65`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      DisplayName: displayName,
      GivenName: client.first_name,
      FamilyName: client.last_name,
      ...(client.email ? { PrimaryEmailAddr: { Address: client.email } } : {}),
    }),
  });
  const createData = await createRes.json();
  return String(createData?.Customer?.Id || '');
}

// ── Main Handler ───────────────────────────────────────────────
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

  // Parse body
  let invoiceId: string;
  try {
    const body = await req.json();
    invoiceId = body.invoice_id;
    if (!invoiceId) throw new Error('invoice_id is required');
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID')!;
  const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET')!;

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date().toISOString();

  // ── 1. Load QB tokens ──
  const { data: tokenRecord, error: tokenErr } = await supabase
    .from('integration_tokens')
    .select('*')
    .eq('service', 'quickbooks')
    .maybeSingle();

  if (tokenErr || !tokenRecord?.realm_id) {
    return new Response(JSON.stringify({ error: 'QuickBooks not connected. Complete OAuth flow first.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let accessToken = tokenRecord.access_token;
  let refreshToken = tokenRecord.refresh_token;
  const realmId = tokenRecord.realm_id;

  // ── 2. Refresh token if expired ──
  const expiresAt = tokenRecord.expires_at ? new Date(tokenRecord.expires_at) : new Date(0);
  if (new Date() >= expiresAt && refreshToken) {
    try {
      const refreshed = await refreshAccessToken(clientId, clientSecret, refreshToken);
      accessToken = refreshed.access_token;
      refreshToken = refreshed.refresh_token;
      const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      await supabase.from('integration_tokens').update({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: newExpiry,
        updated_at: now,
      }).eq('id', tokenRecord.id);
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Token refresh failed: ' + String(err) }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── 3. Load invoice with related data ──
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('*,jobs(*,properties(*)),clients(*)')
    .eq('id', invoiceId)
    .single();

  if (invErr || !invoice) {
    return new Response(JSON.stringify({ error: 'Invoice not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 4. Ensure customer exists in QB ──
  let qbCustomerId: string | undefined;
  if (invoice.clients) {
    try {
      qbCustomerId = await ensureQBCustomer(realmId, accessToken, invoice.clients);
      // Update our DB with QB customer ID
      if (qbCustomerId && !invoice.clients.quickbooks_customer_id) {
        await supabase.from('clients').update({ quickbooks_customer_id: qbCustomerId }).eq('id', invoice.clients.id);
      }
    } catch (_err) {
      // Non-fatal: continue without customer ID
    }
  }

  // ── 5. Look up QB Services item, then build invoice payload ──
  // Dynamically finds the Services item ID rather than assuming ID '1',
  // which varies per QuickBooks account. Falls back to '1' if lookup fails.
  let servicesItemId = '1';
  try {
    servicesItemId = await ensureServicesItem(realmId, accessToken);
  } catch (_err) {
    // Non-fatal: fall back to default
  }

  const lineDescription = `${(invoice.jobs?.job_type || 'Standard').charAt(0).toUpperCase() + (invoice.jobs?.job_type || 'standard').slice(1)} Clean — ${invoice.jobs?.properties?.name || 'Property'}`;
  const qbInvoicePayload: Record<string, unknown> = {
    DocNumber: invoice.invoice_number,
    TxnDate: invoice.created_at?.split('T')[0] || now.split('T')[0],
    DueDate: invoice.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    Line: [
      {
        Amount: parseFloat(invoice.amount || 0),
        DetailType: 'SalesItemLineDetail',
        Description: lineDescription,
        SalesItemLineDetail: {
          ItemRef: { value: servicesItemId, name: 'Services' },
          Qty: 1,
          UnitPrice: parseFloat(invoice.amount || 0),
        },
      },
    ],
    ...(qbCustomerId ? { CustomerRef: { value: qbCustomerId } } : {}),
    ...(invoice.notes ? { CustomerMemo: { value: invoice.notes } } : {}),
  };

  const qbHeaders = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // If already synced, try to update; otherwise create
  let qbInvoiceId: string;
  const existingQbId = invoice.quickbooks_invoice_id?.startsWith('QB-') ? null : invoice.quickbooks_invoice_id;

  if (existingQbId) {
    // Fetch current invoice for SyncToken (required for QB updates)
    const getRes = await fetch(`${QB_API_BASE}/${realmId}/invoice/${existingQbId}?minorversion=65`, { headers: qbHeaders });
    if (getRes.ok) {
      const getData = await getRes.json();
      const syncToken = getData?.Invoice?.SyncToken;
      const updateRes = await fetch(`${QB_API_BASE}/${realmId}/invoice?operation=update&minorversion=65`, {
        method: 'POST',
        headers: qbHeaders,
        body: JSON.stringify({ ...qbInvoicePayload, Id: existingQbId, SyncToken: syncToken, sparse: true }),
      });
      const updateData = await updateRes.json();
      qbInvoiceId = updateData?.Invoice?.Id || existingQbId;
    } else {
      qbInvoiceId = existingQbId;
    }
  } else {
    // Create new invoice
    const createRes = await fetch(`${QB_API_BASE}/${realmId}/invoice?minorversion=65`, {
      method: 'POST',
      headers: qbHeaders,
      body: JSON.stringify(qbInvoicePayload),
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      console.error('QB invoice create failed:', errBody);
      return new Response(JSON.stringify({ error: 'QB invoice creation failed: ' + errBody }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const createData = await createRes.json();
    qbInvoiceId = String(createData?.Invoice?.Id || '');
  }

  // ── 6. Update our invoice record with QB invoice ID ──
  await supabase.from('invoices').update({
    quickbooks_invoice_id: qbInvoiceId,
    updated_at: now,
  }).eq('id', invoiceId);

  // ── 7. Log the activity ──
  await supabase.from('activity_log').insert({
    description: `Invoice ${invoice.invoice_number} synced to QuickBooks (QB ID: ${qbInvoiceId})`,
    type: 'invoice',
    created_at: now,
  });

  return new Response(
    JSON.stringify({
      success: true,
      quickbooks_invoice_id: qbInvoiceId,
      message: `Invoice ${invoice.invoice_number} successfully synced to QuickBooks`,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
