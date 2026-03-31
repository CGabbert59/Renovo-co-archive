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
  role        TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','employee')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', COALESCE(NEW.raw_user_meta_data->>'role','admin'));
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
  job_id                UUID REFERENCES jobs(id) ON DELETE SET NULL,
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

-- Profiles: users can read all, update own
CREATE POLICY "profiles_read" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- All other tables: authenticated users can read/write
CREATE POLICY "clients_all" ON clients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "properties_all" ON properties FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "bookings_all" ON bookings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "jobs_all" ON jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "employees_all" ON employees FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "job_assignments_all" ON job_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "checklists_all" ON checklists FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "checklist_items_all" ON checklist_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "invoices_all" ON invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "media_all" ON media FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "activity_log_all" ON activity_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "integration_tokens_all" ON integration_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- STORAGE BUCKET for media uploads
-- ============================================================
-- Run this in Supabase Dashboard → Storage → New Bucket
-- Name: media
-- Public: YES (so file URLs work without auth)
-- Or run via SQL:
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "media_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'media');
CREATE POLICY "media_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'media');
CREATE POLICY "media_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'media');

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
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);

-- ============================================================
-- SETUP USERS
-- ============================================================
-- After running this schema, create users in Supabase Dashboard:
-- Auth → Users → Invite User
--
-- User 1: Caleb Gabbert
--   Email: caleb@renovoco.com
--   Role: admin
--
-- User 2: Kennan Dowling
--   Email: kennan@renovoco.com
--   Role: admin
--
-- User 3: Mitchell
--   Email: mitchell@renovoco.com
--   Role: admin
--
-- Then update their profiles:
-- UPDATE profiles SET full_name = 'Caleb Gabbert', role = 'admin' WHERE id = '<caleb-uuid>';
-- UPDATE profiles SET full_name = 'Kennan Dowling', role = 'admin' WHERE id = '<kennan-uuid>';
-- UPDATE profiles SET full_name = 'Mitchell', role = 'admin' WHERE id = '<mitchell-uuid>';
