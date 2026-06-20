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
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role','employee')
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email     = EXCLUDED.email,
        role      = EXCLUDED.role;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
-- "JOBS / CHECKLISTS" sections below. job_assignments and media stay fully
-- open here: any team member legitimately manages job assignments and
-- shared documents/photos for any job, by design.)
DROP POLICY IF EXISTS "job_assignments_all" ON job_assignments;
CREATE POLICY "job_assignments_all" ON job_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "media_all" ON media;
CREATE POLICY "media_all" ON media FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- activity_log is an audit trail: any authenticated user may read/append,
-- but no UPDATE/DELETE policy is granted, so RLS denies edits/deletes by
-- default — entries are immutable from the client once written.
DROP POLICY IF EXISTS "activity_log_all" ON activity_log;
DROP POLICY IF EXISTS "activity_log_read" ON activity_log;
CREATE POLICY "activity_log_read" ON activity_log FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "activity_log_insert" ON activity_log;
CREATE POLICY "activity_log_insert" ON activity_log FOR INSERT TO authenticated WITH CHECK (true);
-- integration_tokens is handled below with admin-only access

-- ============================================================
-- STORAGE BUCKET for media uploads
-- ============================================================
-- Run this in Supabase Dashboard → Storage → New Bucket
-- Name: media
-- Public: YES (so file URLs work without auth)
-- Or run via SQL:
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', true, 52428800) -- 50 MiB
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "media_upload" ON storage.objects;
CREATE POLICY "media_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'media');
DROP POLICY IF EXISTS "media_read" ON storage.objects;
CREATE POLICY "media_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'media');
DROP POLICY IF EXISTS "media_delete" ON storage.objects;
CREATE POLICY "media_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'media');

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
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);

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
DROP POLICY IF EXISTS "invoices_insert" ON invoices;
CREATE POLICY "invoices_insert" ON invoices FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  OR (
    status = 'pending'
    AND EXISTS (
      SELECT 1 FROM jobs j JOIN properties p ON p.id = j.property_id
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
     OR NEW.jobs_completed IS DISTINCT FROM OLD.jobs_completed + 1
  THEN
    RAISE EXCEPTION 'Only admins can edit employee records; non-admins may only increment jobs_completed by 1';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_restrict_employee_update ON employees;
CREATE TRIGGER trg_restrict_employee_update
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION public.restrict_employee_update();

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
-- This closes both gaps without touching the open collaborative behavior.
DROP POLICY IF EXISTS "jobs_all" ON jobs;
DROP POLICY IF EXISTS "jobs_select" ON jobs;
CREATE POLICY "jobs_select" ON jobs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "jobs_insert" ON jobs;
CREATE POLICY "jobs_insert" ON jobs FOR INSERT TO authenticated WITH CHECK (true);
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_role_escalation ON profiles;
CREATE TRIGGER trg_prevent_role_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_self_escalation();

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