# Supabase Storage — créer les buckets dans le dashboard ou via SQL

-- Dashboard Supabase > Storage > New bucket (public: false)
-- compta-invoices
-- compta-statements
-- compta-exports

-- Optionnel : secrets par salle (webhook WhatsApp)
-- UPDATE locations SET whatsapp_secret = 'secret-minimes' WHERE slug = 'minimes';
-- UPDATE locations SET bot_url = 'http://host:3011' WHERE slug = 'minimes';
