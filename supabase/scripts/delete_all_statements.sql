-- Supprimer tous les relevés bancaires (et leurs lignes de dépenses en cascade)

DELETE FROM bank_statements;

-- Vérifier
SELECT COUNT(*) AS releves_restants FROM bank_statements;
SELECT COUNT(*) AS lignes_releve_restantes FROM bank_transactions;

-- Fichiers PDF : Supabase → Storage → bucket compta-statements → supprimer manuellement si besoin
