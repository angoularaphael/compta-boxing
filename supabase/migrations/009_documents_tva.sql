-- TVA sur devis / factures émis
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS montant_ht NUMERIC,
  ADD COLUMN IF NOT EXISTS taux_tva NUMERIC NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS montant_tva NUMERIC;

UPDATE documents
SET
  montant_ht = ROUND(montant / (1 + COALESCE(taux_tva, 20) / 100.0), 2),
  montant_tva = ROUND(montant - (montant / (1 + COALESCE(taux_tva, 20) / 100.0)), 2)
WHERE montant_ht IS NULL AND montant IS NOT NULL;
