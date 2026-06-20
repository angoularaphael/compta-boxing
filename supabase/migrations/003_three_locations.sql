-- Compta Boxing — 3 salles (Minimes/États-Unis = même compte)

-- Réaffecter les données éventuelles d'États-Unis vers Minimes
UPDATE invoices
SET location_id = (SELECT id FROM locations WHERE slug = 'minimes')
WHERE location_id = (SELECT id FROM locations WHERE slug = 'etats_unis');

UPDATE bank_statements
SET location_id = (SELECT id FROM locations WHERE slug = 'minimes')
WHERE location_id = (SELECT id FROM locations WHERE slug = 'etats_unis');

UPDATE bank_transactions
SET location_id = (SELECT id FROM locations WHERE slug = 'minimes')
WHERE location_id = (SELECT id FROM locations WHERE slug = 'etats_unis');

UPDATE monthly_closures
SET location_id = (SELECT id FROM locations WHERE slug = 'minimes')
WHERE location_id = (SELECT id FROM locations WHERE slug = 'etats_unis');

UPDATE vendor_aliases
SET location_id = (SELECT id FROM locations WHERE slug = 'minimes')
WHERE location_id = (SELECT id FROM locations WHERE slug = 'etats_unis');

UPDATE locations
SET name = 'Minimes / États-Unis'
WHERE slug = 'minimes';

DELETE FROM locations WHERE slug = 'etats_unis';
