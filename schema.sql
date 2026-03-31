-- ============================================================
-- RENOVO CO. — SUPABASE SCHEMA
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES (linked to Supabase Auth users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','employee')),
  email       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', COALESCE(NEW.raw_user_meta_data->>'role','employee'));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

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
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- ============================================================
-- PROPERTIES
-- ============================================================
CREATE TABLE IF NOT EXISTS properties (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  address       TEXT,
  city          TEXT DEFAULT 'Abilene',
  state         TEXT DEFAULT 'TX',
  zip           TEXT,
  bedrooms      INT DEFAULT 2,
  bathrooms     INT DEFAULT 1,
  platform      TEXT DEFAULT 'airbnb' CHECK (platform IN ('airbnb','vrbo','booking.com','direct')),
  access_notes  TEXT,
  base_rate     NUMERIC(10,2) DEFAULT 80,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_status   ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_client   ON properties(client_id);
CREATE INDEX IF NOT EXISTS idx_properties_platform ON properties(platform);

-- ============================================================
-- BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  guest_name          TEXT NOT NULL,
  guest_email         TEXT,
  platform            TEXT DEFAULT 'airbnb' CHECK (platform IN ('airbnb','vrbo','booking.com','direct')),
  check_in            TIMESTAMPTZ,
  check_out           TIMESTAMPTZ,
  total_amount        NUMERIC(10,2),
  guests_count        INT DEFAULT 1,
  external_booking_id TEXT UNIQUE,
  status              TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled')),
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_property ON bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status   ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_platform ON bookings(platform);
CREATE INDEX IF NOT EXISTS idx_bookings_checkin  ON bookings(check_in);

-- ============================================================
-- JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id          UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  booking_id           UUID REFERENCES bookings(id) ON DELETE SET NULL,
  job_type             TEXT NOT NULL DEFAULT 'standard' CHECK (job_type IN ('standard','deep','rush','staging')),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','in_progress','completed','cancelled')),
  scheduled_date       DATE,
  scheduled_time       TIME,
  base_price           NUMERIC(10,2) DEFAULT 80,
  bedroom_charge       NUMERIC(10,2) DEFAULT 0,
  bathroom_charge      NUMERIC(10,2) DEFAULT 0,
  rush_charge          NUMERIC(10,2) DEFAULT 0,
  deep_clean_multiplier NUMERIC(4,2) DEFAULT 1,
  total_price          NUMERIC(10,2) DEFAULT 80,
  auto_generated       BOOLEAN DEFAULT FALSE,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_property       ON jobs(property_id);
CREATE INDEX IF NOT EXISTS idx_jobs_booking        ON jobs(booking_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status         ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_date ON jobs(scheduled_date);

-- ============================================================
-- EMPLOYEES (Field Contractors)
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name      TEXT NOT NULL,
  last_name       TEXT,
  email           TEXT,
  phone           TEXT,
  pay_rate        NUMERIC(6,2) DEFAULT 15,
  role            TEXT DEFAULT 'employee',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  jobs_completed  INT DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- ============================================================
-- JOB ASSIGNMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS job_assignments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status      TEXT DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','completed')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (job_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_job      ON job_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_assignments_employee ON job_assignments(employee_id);

-- ============================================================
-- CHECKLISTS
-- ============================================================
CREATE TABLE IF NOT EXISTS checklists (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklists_job    ON checklists(job_id);
CREATE INDEX IF NOT EXISTS idx_checklists_status ON checklists(status);

-- ============================================================
-- CHECKLIST ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS checklist_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id UUID NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  task         TEXT NOT NULL,
  category     TEXT,
  sort_order   INT DEFAULT 0,
  completed    BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON checklist_items(checklist_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_category  ON checklist_items(category);

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number        TEXT UNIQUE,
  job_id                UUID REFERENCES jobs(id) ON DELETE SET NULL,
  client_id             UUID REFERENCES clients(id) ON DELETE SET NULL,
  amount                NUMERIC(10,2) NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','paid','overdue','cancelled')),
  due_date              DATE,
  paid_at               TIMESTAMPTZ,
  quickbooks_invoice_id TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_job     ON invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client  ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status  ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due     ON invoices(due_date);

-- ============================================================
-- MEDIA
-- ============================================================
CREATE TABLE IF NOT EXISTS media (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  job_id      UUID REFERENCES jobs(id) ON DELETE SET NULL,
  file_name   TEXT,
  file_url    TEXT,
  file_type   TEXT DEFAULT 'image' CHECK (file_type IN ('image','video','document')),
  caption     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_property ON media(property_id);
CREATE INDEX IF NOT EXISTS idx_media_job      ON media(job_id);

-- ============================================================
-- MESSAGES (Team chat)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL DEFAULT 'Team Member',
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action      TEXT NOT NULL DEFAULT 'update',
  description TEXT,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees       ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE media           ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log    ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- ── PROFILES ──
CREATE POLICY "profiles_own_read"  ON profiles FOR SELECT USING (id = auth.uid() OR get_my_role() = 'admin');
CREATE POLICY "profiles_own_write" ON profiles FOR UPDATE USING (id = auth.uid() OR get_my_role() = 'admin');

-- ── ADMIN: full access to all business tables ──
CREATE POLICY "admin_all_clients"    ON clients        FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "admin_all_properties" ON properties     FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "admin_all_bookings"   ON bookings       FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "admin_all_jobs"       ON jobs           FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "admin_all_employees"  ON employees      FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "admin_all_assignments" ON job_assignments FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "admin_all_checklists" ON checklists     FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "admin_all_items"      ON checklist_items FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "admin_all_invoices"   ON invoices       FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "admin_all_media"      ON media          FOR ALL USING (get_my_role() = 'admin');
CREATE POLICY "admin_all_activity"   ON activity_log   FOR ALL USING (get_my_role() = 'admin');

-- ── EMPLOYEE: assigned jobs + checklists only ──
CREATE POLICY "employee_read_assigned_jobs" ON jobs FOR SELECT
  USING (
    get_my_role() = 'employee' AND
    id IN (
      SELECT ja.job_id FROM job_assignments ja
      JOIN employees e ON e.id = ja.employee_id
      WHERE e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "employee_update_assigned_jobs" ON jobs FOR UPDATE
  USING (
    get_my_role() = 'employee' AND
    id IN (
      SELECT ja.job_id FROM job_assignments ja
      JOIN employees e ON e.id = ja.employee_id
      WHERE e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "employee_read_checklists" ON checklists FOR SELECT
  USING (
    get_my_role() = 'employee' AND
    job_id IN (
      SELECT ja.job_id FROM job_assignments ja
      JOIN employees e ON e.id = ja.employee_id
      WHERE e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "employee_update_checklists" ON checklists FOR UPDATE
  USING (
    get_my_role() = 'employee' AND
    job_id IN (
      SELECT ja.job_id FROM job_assignments ja
      JOIN employees e ON e.id = ja.employee_id
      WHERE e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "employee_read_checklist_items" ON checklist_items FOR SELECT
  USING (
    get_my_role() = 'employee' AND
    checklist_id IN (
      SELECT c.id FROM checklists c
      JOIN job_assignments ja ON ja.job_id = c.job_id
      JOIN employees e ON e.id = ja.employee_id
      WHERE e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "employee_update_checklist_items" ON checklist_items FOR UPDATE
  USING (
    get_my_role() = 'employee' AND
    checklist_id IN (
      SELECT c.id FROM checklists c
      JOIN job_assignments ja ON ja.job_id = c.job_id
      JOIN employees e ON e.id = ja.employee_id
      WHERE e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "employee_read_own_assignments" ON job_assignments FOR SELECT
  USING (
    get_my_role() = 'employee' AND
    employee_id IN (
      SELECT e.id FROM employees e
      WHERE e.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "employee_write_activity" ON activity_log FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ── MESSAGES: any authenticated user can read/write ──
CREATE POLICY "authenticated_read_messages" ON messages
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "authenticated_insert_messages" ON messages
  FOR INSERT WITH CHECK (sender_id = auth.uid());

-- ============================================================
-- SEED: PRICING REFERENCE (comment)
-- Base: $80
-- + $25–40/bedroom (we use $30 avg)
-- + $20/bathroom
-- Rush: +$75
-- Deep clean: ×2 multiplier
-- 4+ bedrooms: $230+ (negotiated flat)
-- ============================================================
