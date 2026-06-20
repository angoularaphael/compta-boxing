-- Corrige bot_url Minimes (us2 — même modèle que gestion-manager)

UPDATE locations
SET
  bot_url = 'http://us2.bot-hosting.net:21334',
  whatsapp_secret = 'secret-minimes'
WHERE slug = 'minimes';
