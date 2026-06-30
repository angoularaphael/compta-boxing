-- Table pour stocker les devis et factures émis
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('devis', 'facture')),
  numero TEXT NOT NULL,
  societe TEXT NOT NULL CHECK (societe IN ('asso_tmbc', 'boxing_center', 'distrix')),
  client_nom TEXT NOT NULL,
  client_email TEXT,
  client_adresse TEXT,
  client_telephone TEXT,
  prestation TEXT NOT NULL,
  montant NUMERIC NOT NULL,
  date_document DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT,
  conditions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_documents_societe ON documents(societe);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);
