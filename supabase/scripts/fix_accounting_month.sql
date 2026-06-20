-- Remet le mois comptable = mois de réception (created_at), pas la date OCR erronée
UPDATE invoices
SET accounting_month = to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM')
WHERE accounting_month IS DISTINCT FROM to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM');

-- Vérifier
SELECT l.slug, i.accounting_month, i.ocr_status, i.file_name, i.created_at
FROM invoices i
JOIN locations l ON l.id = i.location_id
ORDER BY i.created_at DESC;
