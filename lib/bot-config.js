/** Un seul serveur Bothosting pour la compta (QR + factures WhatsApp). */
export const BOTS = [
  { id: 1, slug: 'minimes', label: 'WhatsApp Compta', port: 3011 },
];

export const BOT_URL_ENV_KEYS = {
  minimes: 'BOT_URL_MINIMES',
};
