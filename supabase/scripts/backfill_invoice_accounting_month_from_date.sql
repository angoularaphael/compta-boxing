-- Rattache chaque facture au mois de sa date facture (pas le mois de réception WhatsApp)
UPDATE invoices
SET accounting_month = to_char(invoice_date, 'YYYY-MM')
WHERE invoice_date IS NOT NULL
  AND accounting_month IS DISTINCT FROM to_char(invoice_date, 'YYYY-MM');

SELECT l.slug, i.accounting_month, i.invoice_date, i.file_name
FROM invoices i
JOIN locations l ON l.id = i.location_id
ORDER BY i.invoice_date DESC NULLS LAST, i.created_at DESC;
