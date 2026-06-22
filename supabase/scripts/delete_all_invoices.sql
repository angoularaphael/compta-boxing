-- Supprimer toutes les factures (toutes salles, tous mois)

UPDATE bank_transactions
SET matched_invoice_id = NULL,
    match_type = NULL,
    match_confidence = NULL
WHERE matched_invoice_id IS NOT NULL;

DELETE FROM invoices;

-- Vérifier
SELECT COUNT(*) AS factures_restantes FROM invoices;

-- Fichiers PDF : Supabase → Storage → bucket compta-invoices → supprimer manuellement si besoin
