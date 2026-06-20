-- Minimes : déplacer de us2 (US) vers prem-eu2 (EU) — Vercel n'atteint pas us2.
-- Remplacez PORT_MINIMES par le port Bothosting du nouveau serveur prem-eu2.

UPDATE locations
SET
  bot_url = 'http://prem-eu2.bot-hosting.net:PORT_MINIMES',
  whatsapp_secret = 'secret-minimes'
WHERE slug = 'minimes';
