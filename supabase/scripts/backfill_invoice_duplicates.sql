/**
 * Relance l'extraction du numéro de facture depuis le nom de fichier
 * pour les factures déjà en base (ex. "Facture 655 - VIDOTTO...").
 */
UPDATE invoices
SET invoice_number = upper(
  regexp_replace(
    regexp_replace(file_name, '^.*[Ff]acture\s*(?:n[°º.]?\s*)?([A-Za-z]?\s*\d+).*', '\1'),
    '\s+', '', 'g'
  )
)
WHERE invoice_number IS NULL
  AND file_name ~* 'facture\s*\d+';

-- Marquer les doublons (garde la plus ancienne par numéro)
WITH ranked AS (
  SELECT
    id,
    location_id,
    accounting_month,
    invoice_number,
    ROW_NUMBER() OVER (
      PARTITION BY location_id, accounting_month, invoice_number
      ORDER BY created_at ASC
    ) AS rn
  FROM invoices
  WHERE invoice_number IS NOT NULL
    AND ocr_status NOT IN ('failed', 'duplicate')
)
UPDATE invoices i
SET
  ocr_status = 'duplicate',
  duplicate_of_id = r.keep_id
FROM (
  SELECT a.id, b.id AS keep_id
  FROM ranked a
  JOIN ranked b
    ON a.location_id = b.location_id
   AND a.accounting_month = b.accounting_month
   AND a.invoice_number = b.invoice_number
   AND b.rn = 1
  WHERE a.rn > 1
) r
WHERE i.id = r.id;
