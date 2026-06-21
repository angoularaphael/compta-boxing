-- Numéro de facture + détection des doublons
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_of_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_ocr_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_ocr_status_check
  CHECK (ocr_status IN ('pending', 'ok', 'partial', 'failed', 'duplicate'));

CREATE INDEX IF NOT EXISTS invoices_location_month_number_idx
  ON invoices (location_id, accounting_month, invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_duplicate_of_idx
  ON invoices (duplicate_of_id)
  WHERE duplicate_of_id IS NOT NULL;
