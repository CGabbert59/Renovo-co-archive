-- ============================================================
-- RENOVO CO. — SUPABASE DATABASE SCHEMA
-- Run this in Supabase SQL Editor (project: qofwwztuykerlcxfuutv)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES (links to Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  email       TEXT,
  role        TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','employee')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup (includes email; safe to re-run)
-- Role is intentionally NOT read from raw_user_meta_data: that field is
-- client-supplied at signup time (e.g. via auth.signUp's `data` option), so
-- trusting it would let a self-registered user grant themselves role='admin'
-- if public signup were ever turned on in the dashboard. Every account starts
-- 'employee'; invite-user's post-create profile upsert (using the service
-- role key, only reachable by an existing admin) is what actually promotes
-- an invited user to 'admin'.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    'employee'
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email     = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  quickbooks_customer_id TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROPERTIES
-- ============================================================
CREATE TABLE IF NOT EXISTS properties (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID REFERENCES clients(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  address      TEXT,
  city         TEXT DEFAULT 'Abilene',
  state        TEXT DEFAULT 'TX',
  bedrooms     INTEGER DEFAULT 1,
  bathrooms    INTEGER DEFAULT 1,
  platform     TEXT DEFAULT 'airbnb' CHECK (platform IN ('airbnb','vrbo','booking.com','direct')),
  access_notes TEXT,  -- door codes, lockbox, parking info
  base_rate    NUMERIC(10,2) DEFAULT 80,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id          UUID REFERENCES properties(id) ON DELETE SET NULL,
  guest_name           TEXT NOT NULL,
  guest_email          TEXT,
  platform             TEXT DEFAULT 'airbnb',
  check_in             TIMESTAMPTZ,
  check_out            TIMESTAMPTZ,
  total_amount         NUMERIC(10,2),
  guests_count         INTEGER DEFAULT 1,
  external_booking_id  TEXT,  -- platform's booking ID (for dedup)
  status               TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','pending','cancelled')),
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  -- Prevent duplicate bookings from same platform
  UNIQUE (platform, external_booking_id)
);

-- ============================================================
-- JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id           UUID REFERENCES properties(id) ON DELETE SET NULL,
  booking_id            UUID REFERENCES bookings(id) ON DELETE SET NULL,
  job_type              TEXT DEFAULT 'standard' CHECK (job_type IN ('standard','deep','rush','staging')),
  status                TEXT DEFAULT 'pending' CHECK (status IN ('pending','assigned','in_progress','completed','cancelled')),
  scheduled_date        DATE,
  scheduled_time        TIME,
  base_price            NUMERIC(10,2) DEFAULT 80,
  bedroom_charge        NUMERIC(10,2) DEFAULT 0,
  bathroom_charge       NUMERIC(10,2) DEFAULT 0,
  rush_charge           NUMERIC(10,2) DEFAULT 0,
  deep_clean_multiplier NUMERIC(4,2) DEFAULT 1,
  total_price           NUMERIC(10,2) DEFAULT 80,
  auto_generated        BOOLEAN DEFAULT FALSE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EMPLOYEES (field contractors)
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name      TEXT NOT NULL,
  last_name       TEXT,
  email           TEXT,
  phone           TEXT,
  pay_rate        NUMERIC(10,2) DEFAULT 15,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','inactive')),
  jobs_completed  INTEGER DEFAULT 0,
  role            TEXT DEFAULT 'employee',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- JOB ASSIGNMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS job_assignments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id       UUID REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id  UUID REFERENCES employees(id) ON DELETE CASCADE,
  status       TEXT DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','completed')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CHECKLISTS
-- ============================================================
CREATE TABLE IF NOT EXISTS checklists (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID REFERENCES jobs(id) ON DELETE CASCADE,
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CHECKLIST ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS checklist_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id  UUID REFERENCES checklists(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  task          TEXT NOT NULL,
  sort_order    INTEGER DEFAULT 0,
  completed     BOOLEAN DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id                UUID UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
  client_id             UUID REFERENCES clients(id) ON DELETE SET NULL,
  invoice_number        TEXT UNIQUE,
  amount                NUMERIC(10,2) DEFAULT 0,
  status                TEXT DEFAULT 'draft' CHECK (status IN ('draft','pending','paid','overdue')),
  due_date              DATE,
  paid_at               TIMESTAMPTZ,
  notes                 TEXT,
  quickbooks_invoice_id TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MEDIA / DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS media (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   UUID REFERENCES properties(id) ON DELETE SET NULL,
  job_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,
  file_name     TEXT,
  file_url      TEXT,
  storage_path  TEXT,
  file_type     TEXT DEFAULT 'image' CHECK (file_type IN ('image','document','video')),
  caption       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  description TEXT NOT NULL,
  type        TEXT DEFAULT 'job',
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INTEGRATION TOKENS (QuickBooks OAuth)
-- ============================================================
CREATE TABLE IF NOT EXISTS integration_tokens (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service        TEXT NOT NULL,  -- 'quickbooks'
  access_token   TEXT,
  refresh_token  TEXT,
  realm_id       TEXT,           -- QuickBooks company ID
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Allow authenticated users to read/write all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_tokens ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, insert/update own (trigger handles auto-insert on signup)
DROP POLICY IF EXISTS "profiles_read" ON profiles;
CREATE POLICY "profiles_read" ON profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- All other tables: authenticated users can read/write
-- (clients, properties, bookings, invoices, employees, jobs, checklists, and
-- checklist_items are tightened further down to admin-only writes for their
-- destructive/admin-only actions — see "RESTRICT WRITES TO ADMINS" and
-- "JOBS / CHECKLISTS" sections below. job_assignments stays fully open here:
-- any team member legitimately manages job assignments for any job, by
-- design. media is open for read/insert/update — any team member uploads
-- and views shared documents/photos for any job — but DELETE is admin-only
-- below: an employee deleting a coworker's uploaded photo/document (proof of
-- work, client-dispute evidence) is destructive and irreversible.)
DROP POLICY IF EXISTS "job_assignments_all" ON job_assignments;
CREATE POLICY "job_assignments_all" ON job_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "media_all" ON media;
DROP POLICY IF EXISTS "media_select" ON media;
CREATE POLICY "media_select" ON media FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "media_insert" ON media;
CREATE POLICY "media_insert" ON media FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "media_update" ON media;
CREATE POLICY "media_update" ON media FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "media_delete_admin" ON media;
CREATE POLICY "media_delete_admin" ON media FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
-- activity_log is an audit trail: any authenticated user may read/append,
-- but no UPDATE/DELETE policy is granted, so RLS denies edits/deletes by
-- default — entries are immutable from the client once written.
DROP POLICY IF EXISTS "activity_log_all" ON activity_log;
DROP POLICY IF EXISTS "activity_log_read" ON activity_log;
CREATE POLICY "activity_log_read" ON activity_log FOR SELECT TO authenticated USING (true);
-- WITH CHECK (true) let any authenticated user stamp an activity_log row with
-- ANY user_id, including another teammate's — forging attribution for an
-- action they didn't take. Now a non-admin may only log as themselves or
-- anonymously (NULL); admins and service-role (edge functions, no auth.uid())
-- are unrestricted.
DROP POLICY IF EXISTS "activity_log_insert" ON activity_log;
CREATE POLICY "activity_log_insert" ON activity_log FOR INSERT TO authenticated WITH CHECK (
  user_id IS NULL
  OR user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
-- integration_tokens is handled below with admin-only access

-- ============================================================
-- STORAGE BUCKET for media uploads
-- ============================================================
-- Run this in Supabase Dashboard → Storage → New Bucket
-- Name: media
-- Public: YES (so file URLs work without auth)
-- Or run via SQL:
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media', 'media', true, 52428800, ARRAY[ -- 50 MiB
  'image/*', 'video/*', 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "media_upload" ON storage.objects;
CREATE POLICY "media_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'media');
DROP POLICY IF EXISTS "media_read" ON storage.objects;
CREATE POLICY "media_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'media');
-- Storage-object deletion mirrors the media table's admin-only DELETE above —
-- without this, an employee could still wipe the underlying file even though
-- the media row's DELETE is now blocked, leaving a dangling DB-less object.
DROP POLICY IF EXISTS "media_delete" ON storage.objects;
DROP POLICY IF EXISTS "media_delete_admin" ON storage.objects;
CREATE POLICY "media_delete_admin" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- UPDATED_AT TRIGGERS (auto-stamp on every update)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables that have updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','clients','properties','bookings','jobs','employees','invoices','integration_tokens']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
       CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      t, t, t, t
    );
  END LOOP;
END $$;

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_date ON jobs(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_property_id ON jobs(property_id);
CREATE INDEX IF NOT EXISTS idx_bookings_property_id ON bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_bookings_check_in ON bookings(check_in);
CREATE INDEX IF NOT EXISTS idx_checklists_job_id ON checklists(job_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist_id ON checklist_items(checklist_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_booking_id ON jobs(booking_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_media_property_id ON media(property_id);
CREATE INDEX IF NOT EXISTS idx_media_job_id ON media(job_id);
CREATE INDEX IF NOT EXISTS idx_job_assignments_employee_id ON job_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_job_assignments_job_id ON job_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_properties_client_id ON properties(client_id);

-- ============================================================
-- MESSAGES (dedicated team chat table)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name  TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- Team chat: everyone can read and post; editing/deleting is limited to the
-- author, with admins able to delete any message for moderation.
DROP POLICY IF EXISTS "messages_all" ON messages;
DROP POLICY IF EXISTS "messages_read" ON messages;
CREATE POLICY "messages_read" ON messages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert" ON messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "messages_update" ON messages;
CREATE POLICY "messages_update" ON messages FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "messages_delete" ON messages;
CREATE POLICY "messages_delete" ON messages FOR DELETE TO authenticated USING (
  auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);

-- Derive sender_name server-side from the authenticated user's own profile on
-- every insert/edit, ignoring whatever the client sent. messages_insert/
-- messages_update only constrain user_id via WITH CHECK — sender_name is
-- otherwise free-form, so any authenticated user could POST/PATCH their own
-- real user_id alongside an arbitrary sender_name (e.g. "Caleb Gabbert"),
-- impersonating another team member in the shared, realtime team chat.
-- Also pin created_at to its original value on UPDATE — the app never edits
-- messages today, but messages_update's WITH CHECK only constrains user_id,
-- so without this a user could otherwise backdate/forward-date their own
-- message via a direct API call and distort chat ordering.
CREATE OR REPLACE FUNCTION public.set_message_sender_name()
RETURNS TRIGGER AS $$
DECLARE
  v_full_name TEXT;
  v_email TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
  END IF;
  IF NEW.user_id IS NULL THEN
    NEW.sender_name := 'Team';
    RETURN NEW;
  END IF;
  SELECT full_name INTO v_full_name FROM profiles WHERE id = NEW.user_id;
  IF v_full_name IS NOT NULL AND v_full_name <> '' THEN
    NEW.sender_name := split_part(v_full_name, ' ', 1);
    RETURN NEW;
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
  NEW.sender_name := COALESCE(split_part(v_email, '@', 1), 'Team');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_set_message_sender_name ON messages;
CREATE TRIGGER trg_set_message_sender_name
  BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION public.set_message_sender_name();

-- Enable Supabase Realtime for messages table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;

-- Enable Supabase Realtime for jobs table (live job board updates for all users)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
  END IF;
END $$;

-- ============================================================
-- INTEGRATION_TOKENS: ADMIN-ONLY ACCESS (safe to re-run)
-- ============================================================
-- QB OAuth tokens are restricted to admin users.
-- Edge functions bypass RLS via the service role key, so they are unaffected.
DO $$
BEGIN
  -- Drop the broad permissive policy if it exists (older schema versions created it)
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'integration_tokens' AND policyname = 'integration_tokens_all'
  ) THEN
    DROP POLICY "integration_tokens_all" ON integration_tokens;
  END IF;
  -- Create admin-only policy if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'integration_tokens' AND policyname = 'integration_tokens_admin_only'
  ) THEN
    CREATE POLICY "integration_tokens_admin_only" ON integration_tokens
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

-- Back-fill email for any existing profiles that predate email capture
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- ============================================================
-- PROFILES: ALLOW ADMINS TO UPDATE ANY PROFILE (safe to re-run)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_admin_update'
  ) THEN
    CREATE POLICY "profiles_admin_update" ON profiles FOR UPDATE TO authenticated
      USING (EXISTS (
        SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.role = 'admin'
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.role = 'admin'
      ));
  END IF;
END $$;

-- ============================================================
-- CLIENTS / PROPERTIES / BOOKINGS / INVOICES: RESTRICT WRITES TO ADMINS
-- (safe to re-run)
-- ============================================================
-- These tables previously used a single permissive "_all" policy, so any
-- authenticated employee could create/edit/delete clients, properties,
-- bookings, or invoices via a direct API call (the UI hides these actions
-- behind isAdmin() checks, but that's not enforced at the database level).
-- Reads stay open to all authenticated users because employee-facing pages
-- (Job Board, Job Detail, Checklists) legitimately join across these tables.
-- invoices INSERT allows admins to do anything (manual invoices via
-- createManualInvoice have no job linkage and arbitrary amounts) OR a
-- narrow non-admin case: completing a job auto-creates its invoice
-- (autoCreateInvoice) under the completing employee's own session, so
-- non-admins may only insert a 'pending' invoice whose job/amount/client
-- match a real completed job — they can't fabricate arbitrary invoices.
DROP POLICY IF EXISTS "clients_all" ON clients;
DROP POLICY IF EXISTS "clients_select" ON clients;
CREATE POLICY "clients_select" ON clients FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "clients_write_admin" ON clients;
CREATE POLICY "clients_write_admin" ON clients FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "clients_update_admin" ON clients;
CREATE POLICY "clients_update_admin" ON clients FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "clients_delete_admin" ON clients;
CREATE POLICY "clients_delete_admin" ON clients FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "properties_all" ON properties;
DROP POLICY IF EXISTS "properties_select" ON properties;
CREATE POLICY "properties_select" ON properties FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "properties_write_admin" ON properties;
CREATE POLICY "properties_write_admin" ON properties FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "properties_update_admin" ON properties;
CREATE POLICY "properties_update_admin" ON properties FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "properties_delete_admin" ON properties;
CREATE POLICY "properties_delete_admin" ON properties FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "bookings_all" ON bookings;
DROP POLICY IF EXISTS "bookings_select" ON bookings;
CREATE POLICY "bookings_select" ON bookings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "bookings_write_admin" ON bookings;
CREATE POLICY "bookings_write_admin" ON bookings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "bookings_update_admin" ON bookings;
CREATE POLICY "bookings_update_admin" ON bookings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "bookings_delete_admin" ON bookings;
CREATE POLICY "bookings_delete_admin" ON bookings FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "invoices_all" ON invoices;
DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select" ON invoices FOR SELECT TO authenticated USING (true);
-- Non-admin branch previously only constrained status/job_id/amount/client_id,
-- leaving paid_at and quickbooks_invoice_id unconstrained — a non-admin could
-- insert an invoice that already claims to be paid or already linked to a QB
-- invoice ID, neither of which a freshly-completed job's auto-invoice should
-- ever have. Both are now required NULL on the non-admin path.
DROP POLICY IF EXISTS "invoices_insert" ON invoices;
CREATE POLICY "invoices_insert" ON invoices FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  OR (
    status = 'pending'
    AND paid_at IS NULL
    AND quickbooks_invoice_id IS NULL
    AND EXISTS (
      SELECT 1 FROM jobs j LEFT JOIN properties p ON p.id = j.property_id
      WHERE j.id = invoices.job_id
        AND j.status = 'completed'
        AND COALESCE(j.total_price, 0) = invoices.amount
        AND p.client_id IS NOT DISTINCT FROM invoices.client_id
    )
  )
);
DROP POLICY IF EXISTS "invoices_update_admin" ON invoices;
CREATE POLICY "invoices_update_admin" ON invoices FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "invoices_delete_admin" ON invoices;
CREATE POLICY "invoices_delete_admin" ON invoices FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- employees: INSERT/DELETE restricted to admin (contractor onboarding/offboarding
-- is an admin-only action in the UI). UPDATE stays open at the RLS layer to all
-- authenticated users because completing a job increments jobs_completed for
-- every assigned employee (incrementAssignedEmployeeJobCount) under the
-- completing employee's own session — including coworkers' rows, not just
-- their own. The trg_restrict_employee_update trigger below closes the gap
-- that previously left: non-admins may only ever bump jobs_completed by
-- exactly 1 (plus updated_at) and cannot touch pay_rate, role, status, or
-- contact fields on any row, including their own; admins are unrestricted.
DROP POLICY IF EXISTS "employees_all" ON employees;
DROP POLICY IF EXISTS "employees_select" ON employees;
CREATE POLICY "employees_select" ON employees FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "employees_update" ON employees;
CREATE POLICY "employees_update" ON employees FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "employees_insert_admin" ON employees;
CREATE POLICY "employees_insert_admin" ON employees FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "employees_delete_admin" ON employees;
CREATE POLICY "employees_delete_admin" ON employees FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE OR REPLACE FUNCTION public.restrict_employee_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Trusted server-side automation (edge functions, authenticated with the
  -- service-role key) never carries a user JWT, so auth.uid() is NULL for
  -- these calls and the admin check below would otherwise always fail open
  -- into the restrictive branch. Only a request signed with the project's
  -- service-role secret (never shipped to the browser) can carry this claim.
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.first_name IS DISTINCT FROM OLD.first_name
     OR NEW.last_name IS DISTINCT FROM OLD.last_name
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.phone IS DISTINCT FROM OLD.phone
     OR NEW.pay_rate IS DISTINCT FROM OLD.pay_rate
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.jobs_completed IS DISTINCT FROM OLD.jobs_completed + 1
  THEN
    RAISE EXCEPTION 'Only admins can edit employee records; non-admins may only increment jobs_completed by 1';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_restrict_employee_update ON employees;
CREATE TRIGGER trg_restrict_employee_update
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION public.restrict_employee_update();

-- Atomic increment for employees.jobs_completed, called via RPC from job completion.
-- A JS-side read-then-write would lose updates when two jobs for the same employee
-- complete concurrently; this single UPDATE statement is race-free. Runs as invoker
-- so the employees_update RLS policy and trg_restrict_employee_update trigger still apply.
CREATE OR REPLACE FUNCTION public.increment_employee_jobs_completed(p_employee_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE employees SET jobs_completed = jobs_completed + 1, updated_at = now() WHERE id = p_employee_id;
END;
$$ LANGUAGE plpgsql;

-- Ensure one invoice per job (safe to re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_job_id_key' AND conrelid = 'invoices'::regclass
  ) THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_job_id_key UNIQUE (job_id);
  END IF;
END $$;

-- Prevent duplicate job assignments (safe to re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_assignments_job_employee_unique' AND conrelid = 'job_assignments'::regclass
  ) THEN
    ALTER TABLE job_assignments ADD CONSTRAINT job_assignments_job_employee_unique UNIQUE (job_id, employee_id);
  END IF;
END $$;

-- Atomic status sync for a job's crew assignment, called via RPC after any
-- job_assignments insert/delete. assignEmployee/removeAssignment previously
-- did insert-or-delete, then a separate count() read, then a conditional
-- status UPDATE — three round trips with a window where a concurrent
-- assign/remove on the same job could land between the count and the write,
-- leaving the job 'assigned' with zero crew or 'pending' with crew still on
-- it. Folding the EXISTS check and the UPDATE into one statement closes that
-- window. Runs as invoker so trg_restrict_employee_job_update still applies.
CREATE OR REPLACE FUNCTION public.sync_job_assignment_status(p_job_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE jobs
  SET status = CASE WHEN EXISTS (SELECT 1 FROM job_assignments WHERE job_id = p_job_id) THEN 'assigned' ELSE 'pending' END,
      updated_at = now()
  WHERE id = p_job_id
    AND status IN ('pending', 'assigned');
END;
$$ LANGUAGE plpgsql;

-- Close a TOCTOU gap in job-from-booking creation (safe to re-run): both
-- autoCreateJobFromBooking (index.html) and the booking-webhook do a
-- select-then-insert with no DB-level constraint, so two concurrent calls
-- for the same booking (e.g. a "Sync Jobs" click racing a webhook delivery)
-- could each pass the existing-job check before either insert lands,
-- creating duplicate jobs/checklists. Only non-cancelled jobs are
-- constrained, so re-creating a job after cancellation still works.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'jobs_booking_id_active_unique'
  ) THEN
    CREATE UNIQUE INDEX jobs_booking_id_active_unique ON jobs(booking_id)
      WHERE booking_id IS NOT NULL AND status <> 'cancelled';
  END IF;
END $$;

-- integration_tokens had no uniqueness guard on `service`, but quickbooks-callback
-- and quickbooks-payment-check both assume a single row per service via
-- .maybeSingle() (which throws if more than one row matches). The prior
-- quickbooks-oauth implementation did a select-then-branch with no DB-level
-- constraint, so two near-simultaneous "Connect QuickBooks" clicks could each
-- pass the existence check and insert duplicate service='quickbooks' rows,
-- breaking OAuth completion and payment checks until manually cleaned up.
-- De-duplicate any existing rows (keep the most recently updated, breaking
-- ties by id) before enforcing the constraint, so this is safe to re-run
-- against a database that already hit the race.
DELETE FROM integration_tokens a USING integration_tokens b
  WHERE a.service = b.service AND a.updated_at < b.updated_at;
DELETE FROM integration_tokens a USING integration_tokens b
  WHERE a.service = b.service AND a.updated_at = b.updated_at AND a.id < b.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integration_tokens_service_key' AND conrelid = 'integration_tokens'::regclass
  ) THEN
    ALTER TABLE integration_tokens ADD CONSTRAINT integration_tokens_service_key UNIQUE (service);
  END IF;
END $$;

-- Restrict bookings.platform to the same allowed values as properties.platform
-- (DB-level check; booking-webhook already validates this, this closes the
-- matching gap for direct/admin-entered bookings written via the CRM). Safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_platform_check' AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_platform_check
      CHECK (platform IN ('airbnb','vrbo','booking.com','direct'));
  END IF;
END $$;

-- QuickBooks OAuth CSRF state (safe to re-run): quickbooks-oauth writes a
-- one-time state value here (as the calling admin, so RLS enforces that only
-- admins can initiate a connection); quickbooks-callback must match and
-- consume it before exchanging the auth code for tokens.
ALTER TABLE integration_tokens ADD COLUMN IF NOT EXISTS oauth_state TEXT;
ALTER TABLE integration_tokens ADD COLUMN IF NOT EXISTS oauth_state_created_at TIMESTAMPTZ;

-- ============================================================
-- JOBS / CHECKLISTS: RESTRICT DESTRUCTIVE WRITES TO ADMINS
-- (safe to re-run)
-- ============================================================
-- jobs/checklists/checklist_items previously used a single permissive "_all"
-- policy. Reads and routine status/progress updates legitimately stay open
-- to all authenticated users — any field contractor needs to see the full
-- job board, manage job assignments (the Assignment tab lets any team
-- member add/remove any employee from any job — this is intentional crew
-- self-coordination, unlike the admin-only actions below), upload/delete
-- shared media, start/complete jobs, and check off checklist items.
-- But two actions are admin-only in the UI with no RLS backing:
--   - deleteJob() is gated by isAdmin() and the "Delete Job" button only
--     renders for admins, yet any authenticated user could call
--     `sb.from('jobs').delete()` directly and remove any job (cascading
--     away its checklist, assignments, and invoice history).
--   - createDefaultChecklist() (the "⚡ Generate Checklist" button) only
--     renders for admins — every call site is admin-only (the Job Detail
--     button, syncAllBookingJobs/createJobFromBooking on the admin-only
--     Bookings page, or the booking-webhook edge function which uses the
--     service role key and bypasses RLS anyway) — but any authenticated
--     user could insert checklist/checklist_item rows directly.
--   - createJob() (the "+ New Job" button on Dashboard/Job Board/Calendar,
--     reachable by employees with no isAdmin() gate) let any authenticated
--     user insert a job row with an arbitrary total_price/breakdown —
--     including the staging path, a free-text "agreed price" field — which
--     then flows straight into the auto-created invoice on completion.
-- This closes all three gaps without touching the open collaborative behavior.
DROP POLICY IF EXISTS "jobs_all" ON jobs;
DROP POLICY IF EXISTS "jobs_select" ON jobs;
CREATE POLICY "jobs_select" ON jobs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "jobs_insert" ON jobs;
CREATE POLICY "jobs_insert" ON jobs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "jobs_update" ON jobs;
CREATE POLICY "jobs_update" ON jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "jobs_delete_admin" ON jobs;
CREATE POLICY "jobs_delete_admin" ON jobs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "checklists_all" ON checklists;
DROP POLICY IF EXISTS "checklists_select" ON checklists;
CREATE POLICY "checklists_select" ON checklists FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "checklists_update" ON checklists;
CREATE POLICY "checklists_update" ON checklists FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "checklists_insert_admin" ON checklists;
CREATE POLICY "checklists_insert_admin" ON checklists FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "checklists_delete_admin" ON checklists;
CREATE POLICY "checklists_delete_admin" ON checklists FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "checklist_items_all" ON checklist_items;
DROP POLICY IF EXISTS "checklist_items_select" ON checklist_items;
CREATE POLICY "checklist_items_select" ON checklist_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "checklist_items_update" ON checklist_items;
CREATE POLICY "checklist_items_update" ON checklist_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "checklist_items_insert_admin" ON checklist_items;
CREATE POLICY "checklist_items_insert_admin" ON checklist_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "checklist_items_delete_admin" ON checklist_items;
CREATE POLICY "checklist_items_delete_admin" ON checklist_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- JOBS: RESTRICT NON-ADMIN UPDATES TO STATUS/NOTES (safe to re-run)
-- ============================================================
-- jobs_update (above) stays open at the RLS layer to all authenticated users
-- because crew self-coordination (assigning/unassigning employees, starting/
-- completing jobs, leaving notes) legitimately needs to update the row. But
-- showJobDetail's "Edit Job" modal only shows pricing/scheduling/property
-- fields to admins — employees get a stripped-down status+notes form — and
-- that split is UI-only, not RLS-backed: any authenticated employee could
-- call `sb.from('jobs').update({total_price: ...})` directly and tamper with
-- pricing that flows straight into the auto-created invoice (invoices_insert
-- trusts jobs.total_price as the source of truth). This closes that gap the
-- same way trg_restrict_employee_update closes it for employees: non-admins
-- may only change status (never to 'cancelled' — that stays admin-only, same
-- as the UI dropdown), notes, and updated_at; admins are unrestricted.
--
-- Also blocks non-admins from changing status AWAY FROM 'completed': the UI's
-- completion flow (completeChecklist/updateJobStatus) increments each assigned
-- employee's jobs_completed counter, guarded client-side by an atomic
-- .neq('status','completed') check — but that guard only stops a second click
-- in the UI, not a direct REST call. Without this, a non-admin could revert a
-- completed job to 'pending' via the API and re-complete it through the normal
-- UI flow to inflate jobs_completed without limit.
CREATE OR REPLACE FUNCTION public.restrict_employee_job_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Service-role connections (edge functions, e.g. booking-webhook cancelling
  -- a job when a booking is cancelled) have no auth.uid(), so the admin EXISTS
  -- check below always fails for them — without this bypass, the anti-
  -- cancellation clause would block every service-role job cancellation.
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.property_id IS DISTINCT FROM OLD.property_id
     OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.job_type IS DISTINCT FROM OLD.job_type
     OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
     OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time
     OR NEW.base_price IS DISTINCT FROM OLD.base_price
     OR NEW.bedroom_charge IS DISTINCT FROM OLD.bedroom_charge
     OR NEW.bathroom_charge IS DISTINCT FROM OLD.bathroom_charge
     OR NEW.rush_charge IS DISTINCT FROM OLD.rush_charge
     OR NEW.deep_clean_multiplier IS DISTINCT FROM OLD.deep_clean_multiplier
     OR NEW.total_price IS DISTINCT FROM OLD.total_price
     OR NEW.auto_generated IS DISTINCT FROM OLD.auto_generated
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
     OR (OLD.status = 'completed' AND NEW.status IS DISTINCT FROM OLD.status)
  THEN
    RAISE EXCEPTION 'Only admins can edit job pricing/scheduling/property, cancel a job, or revert a completed job; non-admins may only update status (excluding cancellation or reverting completion) and notes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_restrict_employee_job_update ON jobs;
CREATE TRIGGER trg_restrict_employee_job_update
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION public.restrict_employee_job_update();

-- ============================================================
-- CHECKLIST_ITEMS: RESTRICT NON-ADMIN UPDATES TO COMPLETION STATE
-- (safe to re-run)
-- ============================================================
-- checklist_items_update stays open at the RLS layer to all authenticated
-- users because checking off items during a clean (toggleChecklistItem,
-- index.html) is a normal field-contractor action under their own session.
-- But the app only ever writes {completed, completed_at} there — any
-- authenticated user could otherwise call `sb.from('checklist_items').update()`
-- directly to rewrite task/category/sort_order, or re-parent an item onto a
-- different job's checklist by changing checklist_id, corrupting both
-- checklists. This closes that gap the same way trg_restrict_employee_update
-- closes it for employees: non-admins may only change completed/completed_at;
-- admins are unrestricted.
CREATE OR REPLACE FUNCTION public.restrict_employee_checklist_item_update()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.checklist_id IS DISTINCT FROM OLD.checklist_id
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.task IS DISTINCT FROM OLD.task
     OR NEW.sort_order IS DISTINCT FROM OLD.sort_order
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Only admins can edit checklist item definitions; non-admins may only update completed/completed_at';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_restrict_employee_checklist_item_update ON checklist_items;
CREATE TRIGGER trg_restrict_employee_checklist_item_update
  BEFORE UPDATE ON checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.restrict_employee_checklist_item_update();

-- ============================================================
-- CHECKLISTS: RESTRICT NON-ADMIN UPDATES TO STATUS/COMPLETED_AT
-- (safe to re-run)
-- ============================================================
-- checklists_update stays open at the RLS layer to all authenticated users
-- because advancing a checklist's status as a clean progresses is a normal
-- field-contractor action under their own session. But that left job_id and
-- created_at writable too — any authenticated user could re-parent a
-- checklist onto a different job, detaching it from the job it was created
-- for. Mirrors trg_restrict_employee_checklist_item_update: non-admins may
-- only change status/completed_at; admins and service-role are unrestricted.
CREATE OR REPLACE FUNCTION public.restrict_employee_checklist_update()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Only admins can re-parent or backdate a checklist; non-admins may only update status/completed_at';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_restrict_employee_checklist_update ON checklists;
CREATE TRIGGER trg_restrict_employee_checklist_update
  BEFORE UPDATE ON checklists
  FOR EACH ROW EXECUTE FUNCTION public.restrict_employee_checklist_update();

-- ============================================================
-- NON-NEGATIVE VALUE GUARDS (safe to re-run)
-- ============================================================
-- No DB-level floor previously existed on monetary/count columns. Pricing
-- columns are already admin-only at the trigger layer (trg_restrict_employee_*
-- above), so this isn't a privilege-escalation fix — it's a data-integrity
-- backstop on the paths that ARE allowed to write here (admin UI forms have no
-- client-side min on a few of these, e.g. New Booking amount, New Invoice
-- amount, employee pay rate edit) against a typo'd or buggy negative value
-- flowing into the auto-created invoice or payroll figures.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_prices_nonneg' AND conrelid = 'jobs'::regclass) THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_prices_nonneg CHECK (
      base_price >= 0 AND bedroom_charge >= 0 AND bathroom_charge >= 0
      AND rush_charge >= 0 AND total_price >= 0 AND deep_clean_multiplier > 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_pay_rate_nonneg' AND conrelid = 'employees'::regclass) THEN
    ALTER TABLE employees ADD CONSTRAINT employees_pay_rate_nonneg CHECK (pay_rate >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_amount_nonneg' AND conrelid = 'invoices'::regclass) THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_amount_nonneg CHECK (amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_amount_nonneg' AND conrelid = 'bookings'::regclass) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_amount_nonneg CHECK (total_amount IS NULL OR total_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_guests_positive' AND conrelid = 'bookings'::regclass) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_guests_positive CHECK (guests_count >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_rooms_nonneg' AND conrelid = 'properties'::regclass) THEN
    ALTER TABLE properties ADD CONSTRAINT properties_rooms_nonneg CHECK (bedrooms >= 0 AND bathrooms >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_jobs_completed_nonneg' AND conrelid = 'employees'::regclass) THEN
    ALTER TABLE employees ADD CONSTRAINT employees_jobs_completed_nonneg CHECK (jobs_completed >= 0);
  END IF;
END $$;

-- ============================================================
-- PREVENT ROLE SELF-ESCALATION (safe to re-run)
-- ============================================================
-- Non-admin users cannot elevate their own role via direct API calls.
-- Admins can still update any profile via profiles_admin_update RLS policy.
CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation()
RETURNS TRIGGER AS $$
BEGIN
  -- If a user is updating their own row and attempting to change their role
  IF NEW.id = auth.uid() AND OLD.role IS DISTINCT FROM NEW.role THEN
    -- Check if the requester is currently an admin
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      -- Silently preserve the original role (no error, no privilege gain)
      NEW.role := OLD.role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prevent_role_escalation ON profiles;
CREATE TRIGGER trg_prevent_role_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_self_escalation();

-- ============================================================
-- ATOMIC LAST-ADMIN-SAFE PROFILE UPDATE (safe to re-run)
-- ============================================================
-- invite-user's "update_profile" action (Settings -> Users -> edit) previously
-- checked isLastAdmin() and then ran the full_name/role UPDATE as two separate
-- round trips. Two concurrent demote requests targeting two DIFFERENT admins
-- (e.g. both fired from Settings while exactly 2 admins remain) could each see
-- admin count = 2 in their own check, both pass, and both demote — leaving
-- zero admins able to manage users, roles, or pricing. Locking every admin row
-- with FOR UPDATE before re-counting serializes concurrent calls: the second
-- call blocks until the first's single-statement transaction commits, then
-- re-counts and correctly sees the post-demotion total. invite-user now calls
-- this RPC instead of a plain update for that action; isLastAdmin() in
-- invite-user/index.ts still guards the DELETE path separately, since deleting
-- a user happens via the GoTrue Admin API (outside any transaction this
-- function controls) and can't be folded into the same atomic check.
CREATE OR REPLACE FUNCTION public.update_profile_role_safe(p_target_id UUID, p_full_name TEXT, p_role TEXT)
RETURNS TEXT AS $$
DECLARE
  v_admin_count INT;
  v_updated INT;
BEGIN
  PERFORM 1 FROM profiles WHERE role = 'admin' FOR UPDATE;

  IF p_role = 'employee' THEN
    SELECT count(*) INTO v_admin_count FROM profiles WHERE role = 'admin';
    IF v_admin_count <= 1 AND EXISTS (SELECT 1 FROM profiles WHERE id = p_target_id AND role = 'admin') THEN
      RETURN 'last_admin';
    END IF;
  END IF;

  UPDATE profiles SET full_name = p_full_name, role = p_role, updated_at = now()
  WHERE id = p_target_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN 'not_found';
  END IF;
  RETURN 'ok';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PREVENT PROFILE FIELD TAMPERING (safe to re-run)
-- ============================================================
-- profiles_update's RLS (auth.uid() = id, no column restriction) lets a user
-- update any column on their OWN row — no app UI calls this directly (profile
-- edits all go through the invite-user edge function), but any authenticated
-- user can still PATCH it directly via the REST API. That left two columns
-- with no legitimate self-edit use exposed: `email` (could be set to diverge
-- from the real auth.users.email, spoofing identity anywhere the UI displays
-- profiles.email) and `created_at` (backdating one's own account). full_name
-- is left freely self-editable. Self-scoped like prevent_role_self_escalation,
-- so service-role calls (auth.uid() = NULL) are unaffected.
CREATE OR REPLACE FUNCTION public.prevent_profile_field_tampering()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id = auth.uid() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    NEW.email := OLD.email;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prevent_profile_field_tampering ON profiles;
CREATE TRIGGER trg_prevent_profile_field_tampering
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_field_tampering();

-- ============================================================
-- SETUP USERS
-- ============================================================
-- STEP 1: Create Caleb in Supabase Dashboard → Auth → Users → Add user → Create new user
--   Email: caleb@renovoco.com   Password: <secure>   Auto Confirm: ON
--
-- STEP 2: Run these UPDATEs immediately (trigger fires on creation, no sign-in needed):
-- UPDATE profiles SET full_name = 'Caleb Gabbert',  role = 'admin'
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'caleb@renovoco.com');
--
-- STEP 3: Log in to the CRM as Caleb → Settings → Users → Add User
--   to create Kennan and Mitchell (no SQL required for them).
--
-- OR create all three via Dashboard and run all three UPDATEs at once:
-- UPDATE profiles SET full_name = 'Caleb Gabbert',  role = 'admin'
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'caleb@renovoco.com');
-- UPDATE profiles SET full_name = 'Kennan Dowling', role = 'admin'
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'kennan@renovoco.com');
-- UPDATE profiles SET full_name = 'Mitchell', role = 'admin'
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'mitchell@renovoco.com');