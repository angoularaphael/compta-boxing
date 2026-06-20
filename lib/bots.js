import dns from 'node:dns';
import http from 'node:http';
import { BOT_URL_ENV_KEYS } from './bot-config.js';

dns.setDefaultResultOrder('ipv4first');

export { BOTS } from './bot-config.js';

export function botUrlFromEnv(slug) {
  const key = BOT_URL_ENV_KEYS[slug];
  const raw = key ? process.env[key] : '';
  return String(raw || '').trim().replace(/\/$/, '');
}

export function botUrlFromLocation(location) {
  const fromDb = String(location?.bot_url || '').trim().replace(/\/$/, '');
  if (fromDb) return fromDb;
  return botUrlFromEnv(location?.slug);
}

function fetchJson(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          reject(new Error('Réponse bot illisible'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Bot injoignable (timeout)')); });
  });
}

export async function fetchBotStatus(botUrl) {
  if (!botUrl) {
    return {
      configured: false,
      connected: false,
      qr: null,
      error: 'URL du bot non configurée (Supabase bot_url ou BOT_URL_* sur Vercel).',
    };
  }

  try {
    const health = await fetchJson(`${botUrl}/api/health`);
    if (health.data?.connected) {
      return {
        configured: true,
        connected: true,
        name: health.data.name,
        location: health.data.location,
        qr: null,
        error: null,
      };
    }

    try {
      const qrRes = await fetchJson(`${botUrl}/api/qr`);
      if (qrRes.data?.connected) {
        return { configured: true, connected: true, qr: null, error: null };
      }
      return {
        configured: true,
        connected: false,
        qr: qrRes.data?.qr || null,
        error: qrRes.data?.error || null,
      };
    } catch {
      return {
        configured: true,
        connected: false,
        qr: null,
        error: 'En attente du QR code — le bot démarre peut-être encore.',
      };
    }
  } catch (e) {
    return {
      configured: true,
      connected: false,
      qr: null,
      error: e.message || 'Impossible de joindre le bot',
    };
  }
}
