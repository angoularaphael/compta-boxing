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

function requestJson(url, { method = 'GET', body = null, timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      timeout: timeoutMs,
    };
    const req = http.request(options, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(text) });
        } catch {
          reject(new Error('Réponse bot illisible'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Bot injoignable (timeout)')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function fetchJson(url, timeoutMs = 12000) {
  return requestJson(url, { timeoutMs });
}

function statusFromPayload(data) {
  return {
    configured: true,
    connected: Boolean(data?.connected),
    connecting: Boolean(data?.connecting),
    name: data?.name || null,
    location: data?.location || null,
    qr: data?.qr || null,
    error: data?.qrError || data?.error || null,
  };
}

export async function fetchBotStatus(botUrl) {
  if (!botUrl) {
    return {
      configured: false,
      connected: false,
      connecting: false,
      qr: null,
      error: 'URL du bot non configurée (Supabase bot_url ou BOT_URL_* sur Vercel).',
    };
  }

  try {
    const statusRes = await fetchJson(`${botUrl}/api/status`);
    if (statusRes.status < 500) {
      return statusFromPayload(statusRes.data);
    }
  } catch {
    /* ancien bot sans /api/status */
  }

  try {
    const health = await fetchJson(`${botUrl}/api/health`);
    if (health.data?.connected) {
      return statusFromPayload({ ...health.data, connected: true });
    }

    try {
      const qrRes = await fetchJson(`${botUrl}/api/qr`);
      if (qrRes.data?.connected) {
        return statusFromPayload({ connected: true });
      }
      return statusFromPayload({
        connected: false,
        connecting: Boolean(health.data?.connecting),
        qr: qrRes.data?.qr || null,
        error: qrRes.data?.error || null,
      });
    } catch {
      return statusFromPayload({
        connected: false,
        connecting: Boolean(health.data?.connecting),
        error: 'Cliquez sur « Générer le QR » pour afficher le code.',
      });
    }
  } catch (e) {
    return {
      configured: true,
      connected: false,
      connecting: false,
      qr: null,
      error: e.message || 'Impossible de joindre le bot',
    };
  }
}

export async function fetchBotAction(botUrl, action, body = {}) {
  if (!botUrl) throw new Error('URL du bot non configurée');
  const routes = { start: '/api/start', stop: '/api/stop', logout: '/api/logout' };
  const path = routes[action];
  if (!path) throw new Error(`Action inconnue: ${action}`);

  const res = await requestJson(`${botUrl}${path}`, {
    method: 'POST',
    body,
    timeoutMs: action === 'logout' ? 10000 : 8000,
  });
  if (res.status >= 400) {
    throw new Error(res.data?.error || `Bot inaccessible (HTTP ${res.status})`);
  }
  return res.data;
}
