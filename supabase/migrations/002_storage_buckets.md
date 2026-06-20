# Supabase Storage — créer les buckets dans le dashboard ou via SQL

-- Dashboard Supabase > Storage > New bucket (public: false)
-- compta-invoices
-- compta-statements
-- compta-exports

-- Secrets & bots (3 salles) — après migration 003_three_locations.sql
-- UPDATE locations SET whatsapp_secret = 'secret-minimes', bot_url = 'http://host:3011' WHERE slug = 'minimes';
-- UPDATE locations SET whatsapp_secret = 'secret-st-cyprien', bot_url = 'http://host:3012' WHERE slug = 'st_cyprien';
-- UPDATE locations SET whatsapp_secret = 'secret-ramonville', bot_url = 'http://host:3013' WHERE slug = 'ramonville';
