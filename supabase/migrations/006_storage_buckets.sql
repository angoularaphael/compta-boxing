-- Buckets Storage pour factures, relevés et exports

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('compta-invoices', 'compta-invoices', false, 52428800, NULL),
  ('compta-statements', 'compta-statements', false, 52428800, NULL),
  ('compta-exports', 'compta-exports', false, 104857600, NULL)
ON CONFLICT (id) DO NOTHING;
