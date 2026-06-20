-- URLs Bothosting pour les QR dans l'app (Connexion WhatsApp)

UPDATE locations
SET
  bot_url = 'http://us2.bot-hosting.net:21334',
  whatsapp_secret = 'secret-minimes'
WHERE slug = 'minimes';

UPDATE locations
SET
  bot_url = 'http://prem-eu2.bot-hosting.net:20405',
  whatsapp_secret = 'secret-st-cyprien'
WHERE slug = 'st_cyprien';

UPDATE locations
SET
  bot_url = 'http://prem-eu4.bot-hosting.net:21357',
  whatsapp_secret = 'secret-ramonville'
WHERE slug = 'ramonville';
