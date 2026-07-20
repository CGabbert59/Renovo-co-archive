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

// QB API base URLs
const QB_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

// Returns YYYY-MM-DD for the given instant as seen in Abilene, TX (America/Chicago),
// not the server's local timezone (Deno edge runtime is UTC) and not a raw UTC slice —
// mirrors centralDateString() in booking-webhook/index.ts.
function centralDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

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
// Dynamically resolves the income account rather than assuming ID '1'.
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
  } else {
    console.error('QB Services item lookup failed:', queryRes.status, await queryRes.text());
  }

  // Resolve a real income account ID from this QB account
  let incomeAccountRef: { name: string; value: string } | null = null;
  try {
    const acctRes = await fetch(
      `${QB_API_BASE}/${realmId}/query?query=${encodeURIComponent(
        "SELECT * FROM Account WHERE AccountType = 'Income' AND Active = true ORDERBY Name MAXRESULTS 5"
      )}&minorversion=65`,
      { headers }
    );
    if (acctRes.ok) {
      const acctData = await acctRes.json();
      // Prefer an account whose name contains "Service" or "Income", else take first
      const accounts: Array<{ Id: string; Name: string }> = acctData?.QueryResponse?.Account || [];
      const preferred = accounts.find(a => /service|income/i.test(a.Name)) || accounts[0];
      if (preferred) incomeAccountRef = { name: preferred.Name, value: String(preferred.Id) };
    } else {
      console.error('QB income account lookup failed:', acctRes.status, await acctRes.text());
    }
  } catch (acctErr) {
    console.error('QB income account lookup threw:', acctErr);
  }

  if (!incomeAccountRef) {
    throw new Error('No active Income account found in QuickBooks to attach a Services item to.');
  }

  // Create Services item with resolved income account
  const createRes = await fetch(`${QB_API_BASE}/${realmId}/item?minorversion=65`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      Name: 'Services',
      Type: 'Service',
      IncomeAccountRef: incomeAccountRef,
    }),
  });
  if (createRes.ok) {
    const createData = await createRes.json();
    const itemId = createData?.Item?.Id;
    if (itemId) return String(itemId);
  }

  // Creation failed — surface the error rather than returning an invalid account ref ID,
  // which would silently corrupt QB invoice line items.
  const errBody = createRes.ok ? 'empty response' : await createRes.text().catch(() => createRes.status.toString());
  console.error('QB Services item creation failed:', errBody);
  throw new Error(`Could not find or create a "Services" item in QuickBooks (${errBody}). Create one manually in your QB account, then retry.`);
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
  const safeName = displayName.replace(/'/g, "''");
  const queryRes = await fetch(
    `${QB_API_BASE}/${realmId}/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${safeName}'`)}&minorversion=65`,
    { headers }
  );
  if (queryRes.ok) {
    const queryData = await queryRes.json();
    const existing = queryData?.QueryResponse?.Customer?.[0];
    if (existing) return String(existing.Id);
  } else {
    console.error('QB customer lookup failed:', queryRes.status, await queryRes.text());
  }

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
  if (!createRes.ok) {
    console.error('QB customer creation failed:', createRes.status, await createRes.text());
    return '';
  }
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

  // Only admins may sync invoices to QuickBooks (matches the Invoices page being admin-only in the UI)
  const { data: callerProfile } = await userSupabase.from('profiles').select('role').eq('id', user.id).single();
  if (callerProfile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden — admin role required' }), {
      status: 403,
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
  const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
  const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({ error: 'QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET must be set in environment variables.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

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
  if (new Date() >= expiresAt && !refreshToken) {
    return new Response(JSON.stringify({ error: 'QuickBooks token expired and no refresh token is available. Please reconnect QuickBooks via Settings → Integrations.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (new Date() >= expiresAt && refreshToken) {
    try {
      const refreshed = await refreshAccessToken(clientId, clientSecret, refreshToken);
      accessToken = refreshed.access_token;
      // QB may omit refresh_token when issuing a new access token (RFC 6749 §6);
      // fall back to the existing token so we don't null it out in the DB.
      refreshToken = refreshed.refresh_token || tokenRecord.refresh_token;
      const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      const { error: persistErr } = await supabase.from('integration_tokens').update({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: newExpiry,
        updated_at: now,
      }).eq('id', tokenRecord.id);
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
        const { error: custLinkErr } = await supabase.from('clients').update({ quickbooks_customer_id: qbCustomerId }).eq('id', invoice.clients.id);
        if (custLinkErr) {
          // Non-fatal: the invoice sync below still succeeds, but log so a failed
          // write-back doesn't go unnoticed and cause a duplicate QB customer next sync.
          console.error('Failed to persist QB customer ID to clients row:', custLinkErr);
        }
      }
    } catch (err) {
      // Non-fatal: continue without customer ID
      console.error('QB customer creation/lookup failed:', err);
    }
  }

  // ── 5. Look up (or create) QB Services item ──
  // Dynamically finds/creates the Services item rather than assuming ID '1'.
  let servicesItemId: string;
  try {
    servicesItemId = await ensureServicesItem(realmId, accessToken);
  } catch (itemErr) {
    return new Response(JSON.stringify({
      error: 'Could not find or create a "Services" item in QuickBooks. Verify your QB token is valid and your account has at least one active Income account.',
      detail: String(itemErr),
    }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  if (invoice.amount == null || isNaN(parseFloat(String(invoice.amount)))) {
    return new Response(JSON.stringify({ error: `Invoice ${invoice.invoice_number} has no valid amount — cannot sync to QuickBooks. Edit the invoice to set an amount.` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const jobType = invoice.jobs?.job_type || 'standard';
  const jobTypeLabel = jobType === 'staging' ? 'Staging Service'
    : `${jobType.charAt(0).toUpperCase() + jobType.slice(1)} Clean`;
  const lineDescription = `${jobTypeLabel} — ${invoice.jobs?.properties?.name || 'Property'}`;
  const invoiceAmount = parseFloat(String(invoice.amount));
  const qbInvoicePayload: Record<string, unknown> = {
    DocNumber: invoice.invoice_number,
    TxnDate: centralDateString(invoice.created_at ? new Date(invoice.created_at) : new Date(now)),
    DueDate: invoice.due_date || centralDateString(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    Line: [
      {
        Amount: invoiceAmount,
        DetailType: 'SalesItemLineDetail',
        Description: lineDescription,
        SalesItemLineDetail: {
          ItemRef: { value: servicesItemId, name: 'Services' },
          Qty: 1,
          UnitPrice: invoiceAmount,
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
  // The definite-assignment assertion (!) tells TypeScript this is always assigned
  // before use — the logic across the two if(!existingQbId / existingQbId) branches
  // is exhaustive at runtime but not statically provable due to the mutable
  // existingQbId mutation (404 branch sets it to null to fall through to the create path).
  let qbInvoiceId!: string;
  let existingQbId = invoice.quickbooks_invoice_id?.startsWith('QB-') ? null : invoice.quickbooks_invoice_id;

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
      if (!updateRes.ok) {
        const errBody = await updateRes.text();
        console.error('QB invoice update failed:', errBody);
        return new Response(JSON.stringify({ error: 'QB invoice update failed: ' + errBody }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const updateData = await updateRes.json();
      qbInvoiceId = updateData?.Invoice?.Id || existingQbId;
    } else if (getRes.status === 404) {
      // The linked QB invoice was deleted or voided on QuickBooks' side — our
      // stored ID no longer resolves to anything there, so every future sync
      // attempt would otherwise 502 forever. Treat it like this invoice was
      // never synced and fall through to creating a fresh one below.
      console.warn(`QB invoice ${existingQbId} not found in QuickBooks (likely deleted/voided) — creating a new invoice instead`);
      existingQbId = null;
    } else {
      const errBody = await getRes.text();
      console.error('QB invoice fetch (for SyncToken) failed:', getRes.status, errBody);
      return new Response(JSON.stringify({ error: 'Could not fetch current QuickBooks invoice to update it: ' + errBody }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  if (!existingQbId) {
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
    if (!qbInvoiceId) {
      console.error('QB invoice create succeeded but returned no Invoice.Id:', JSON.stringify(createData));
      return new Response(JSON.stringify({ error: 'QB invoice created but returned no ID — cannot link to local record. Check QuickBooks directly.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── 6. Update our invoice record with QB invoice ID ──
  const { error: storeErr } = await supabase.from('invoices').update({
    quickbooks_invoice_id: qbInvoiceId,
    updated_at: now,
  }).eq('id', invoiceId);

  if (storeErr) {
    console.error('Failed to store QB invoice ID on invoice record:', storeErr);
    return new Response(JSON.stringify({
      error: `Synced to QuickBooks (QB ID: ${qbInvoiceId}) but failed to save that ID locally — retrying will create a duplicate in QuickBooks. Save this QB ID and contact an admin.`,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── 7. Log the activity ──
  const { error: logErr } = await supabase.from('activity_log').insert({
    description: `Invoice ${invoice.invoice_number} synced to QuickBooks (QB ID: ${qbInvoiceId})`,
    type: 'invoice',
    created_at: now,
  });
  if (logErr) console.error('Failed to log QB sync activity:', logErr);

  return new Response(
    JSON.stringify({
      success: true,
      quickbooks_invoice_id: qbInvoiceId,
      message: `Invoice ${invoice.invoice_number} successfully synced to QuickBooks`,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
