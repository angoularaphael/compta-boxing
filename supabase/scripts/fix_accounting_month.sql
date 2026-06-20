-- Remet le mois comptable = mois de réception (created_at), pas la date OCR erronée
UPDATE invoices
SET accounting_month = to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM')
WHERE accounting_month IS DISTINCT FROM to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM');

-- Vérifier
SELECT slug, accounting_month, ocr_status, file_name, created_at
FROM invoices i
JOIN locations l ON l.id = i.location_id
ORDER BY created_at DESC;
