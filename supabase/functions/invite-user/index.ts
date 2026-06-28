// ============================================================
// Renovo Co. — Admin User Management Edge Function
// Supabase Edge Function (Deno runtime)
//
// Deploy: supabase functions deploy invite-user
//
// Allows admin users to create or delete Supabase auth users.
// Caller must be an authenticated admin (role checked via profiles table).
//
// POST   /functions/v1/invite-user  { email, full_name, role, password }
// DELETE /functions/v1/invite-user  { user_id }
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_ANON_KEY
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
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
};

// True only if targetId is currently an admin AND is the last one — used to
// block both delete and demote-to-employee from leaving zero admin accounts.
async function isLastAdmin(adminClient: ReturnType<typeof createClient>, targetId: string): Promise<boolean> {
  const { data: targetProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', targetId)
    .single();
  if (targetProfile?.role !== 'admin') return false;

  const { count } = await adminClient
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin');
  return (count ?? 0) <= 1;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Validate caller session ──────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
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

  // Verify caller is authenticated
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized — invalid session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Verify caller is admin
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerProfile } = await adminClient
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

  // ── Parse body ────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── DELETE: Remove a user ──────────────────────────────
  if (req.method === 'DELETE') {
    const { user_id } = body as { user_id: string };
    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prevent admins from deleting themselves
    if (user_id === user.id) {
      return new Response(JSON.stringify({ error: 'Cannot delete your own account' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prevent deleting the last remaining admin — would leave the CRM with no
    // account able to manage users, roles, or pricing.
    if (await isLastAdmin(adminClient, user_id)) {
      return new Response(JSON.stringify({ error: 'Cannot delete the last remaining admin' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user_id);
    if (deleteErr) {
      return new Response(JSON.stringify({ error: 'Failed to delete user: ' + deleteErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'User deleted successfully' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── POST: Update password (when user_id provided) or Create user ──
  const { email, full_name, role, password, user_id: targetUserId, _action } = body as {
    email: string;
    full_name: string;
    role: string;
    password: string;
    user_id?: string;
    _action?: string;
  };

  // If updating an existing user's profile (name + role) — bypasses RLS via service role
  if (_action === 'update_profile' && targetUserId) {
    if (!full_name) {
      return new Response(JSON.stringify({ error: 'full_name is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (role !== 'admin' && role !== 'employee') {
      return new Response(JSON.stringify({ error: 'role must be "admin" or "employee"' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prevent demoting the last remaining admin — same rationale as the
    // delete guard above.
    if (role === 'employee' && (await isLastAdmin(adminClient, targetUserId))) {
      return new Response(JSON.stringify({ error: 'Cannot demote the last remaining admin' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // .select() + row-count check: a non-existent targetUserId otherwise
    // updates zero rows with no error, so the caller would see "Profile
    // updated successfully" for a user that was never touched (or never
    // existed).
    const { data: updatedRows, error: profileErr } = await adminClient
      .from('profiles')
      .update({ full_name, role, updated_at: new Date().toISOString() })
      .eq('id', targetUserId)
      .select('id');
    if (profileErr) {
      return new Response(JSON.stringify({ error: 'Failed to update profile: ' + profileErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true, message: 'Profile updated successfully' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // If updating an existing user's password
  if (_action === 'update_password' && targetUserId && password) {
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { error: pwErr } = await adminClient.auth.admin.updateUserById(targetUserId, { password });
    if (pwErr) {
      return new Response(JSON.stringify({ error: 'Failed to update password: ' + pwErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true, message: 'Password updated successfully' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!email || !full_name || !password) {
    return new Response(JSON.stringify({ error: 'email, full_name, and password are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email format' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (password.length < 8) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (role !== undefined && role !== 'admin' && role !== 'employee') {
    return new Response(JSON.stringify({ error: 'role must be "admin" or "employee"' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userRole = role === 'admin' ? 'admin' : 'employee';

  // Create auth user
  const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role: userRole },
  });

  if (createErr) {
    return new Response(JSON.stringify({ error: 'Failed to create user: ' + createErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Set the profile's role/name. The on_auth_user_created trigger already
  // inserted a profile row defaulting to role='employee' (it never trusts
  // client-supplied metadata), so this upsert is the only step that promotes
  // an invited admin — its failure must not be swallowed, or the caller would
  // see "user created successfully" while the new account is stuck as employee.
  if (newUser?.user) {
    const { error: profileErr } = await adminClient.from('profiles').upsert({
      id: newUser.user.id,
      email,
      full_name,
      role: userRole,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (profileErr) {
      return new Response(JSON.stringify({
        error: `User account created but failed to set profile role: ${profileErr.message}. The account exists as 'employee' — retry via Edit User, or delete and recreate.`,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      user_id: newUser?.user?.id,
      message: `User ${full_name} (${email}) created successfully`,
    }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});