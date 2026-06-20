-- Compta Boxing — 3 salles, factures d'achat, relevés, rapprochement

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_users_email_idx ON app_users (lower(email));

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  whatsapp_secret TEXT,
  bot_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO locations (slug, name) VALUES
  ('minimes', 'Minimes / États-Unis'),
  ('st_cyprien', 'Saint-Cyprien'),
  ('ramonville', 'Ramonville')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  invoice_date DATE,
  amount_ttc NUMERIC(12, 2),
  vendor_name TEXT,
  accounting_month TEXT NOT NULL,
  ocr_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ocr_status IN ('pending', 'ok', 'partial', 'failed')),
  ocr_raw TEXT,
  source TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (source IN ('whatsapp', 'upload', 'manual')),
  source_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoices_location_month_idx
  ON invoices (location_id, accounting_month, invoice_date);

CREATE TABLE IF NOT EXISTS bank_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  accounting_month TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, accounting_month)
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  tx_date DATE NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  matched_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  match_type TEXT CHECK (match_type IN ('auto_strict', 'auto_fuzzy', 'manual')),
  match_confidence NUMERIC(5, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_transactions_unmatched_idx
  ON bank_transactions (location_id, statement_id)
  WHERE matched_invoice_id IS NULL;

CREATE TABLE IF NOT EXISTS vendor_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  bank_label TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vendor_aliases_label_idx ON vendor_aliases (lower(bank_label));

CREATE TABLE IF NOT EXISTS monthly_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  accounting_month TEXT NOT NULL,
  export_path TEXT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, accounting_month)
);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_closures ENABLE ROW LEVEL SECURITY;
