import dns from 'node:dns';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
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

function isHtmlResponse(text) {
  const t = String(text).trim().toLowerCase();
  return t.startsWith('<!doctype html') || t.startsWith('<html');
}

function parseBody(text, statusCode) {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error('Réponse bot illisible (JSON invalide).');
    }
  }
  if (isHtmlResponse(trimmed)) {
    throw new Error(
      'Bot inaccessible (page HTML). Vérifiez que Bothosting tourne et que l\'URL bot_url est correcte.'
    );
  }
  const msg = trimmed.slice(0, 200) || `Erreur bot HTTP ${statusCode}`;
  return { error: msg };
}

function botError(message, status = 502) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function requestJson(url, { method = 'GET', body = null, timeoutMs = 12000 } = {}) {
  const parsed = new URL(url);
  let hostname = parsed.hostname;
  try {
    const resolved = await lookup(parsed.hostname, { family: 4 });
    hostname = resolved.address;
  } catch {
    /* garde le hostname */
  }

  const payload = body ? JSON.stringify(body) : null;
  const path = `${parsed.pathname}${parsed.search}`;
  const port = parsed.port ? Number(parsed.port) : 80;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname,
        port,
        path,
        method,
        family: 4,
        headers: {
          Host: parsed.host,
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
          try {
            const data = parseBody(text, res.statusCode);
            resolve({ status: res.statusCode, data });
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(botError(err.message || 'Bot injoignable', 502));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(botError('Bot injoignable (timeout)', 504));
    });

    if (payload) req.write(payload);
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
    const statusRes = await fetchJson(`${botUrl}/api/status`, 6000);
    if (statusRes.status === 200) {
      return statusFromPayload(statusRes.data);
    }
  } catch {
    /* ancien bot sans /api/status */
  }

  try {
    const health = await fetchJson(`${botUrl}/api/health`, 8000);
    if (health.data?.connected) {
      return statusFromPayload({ ...health.data, connected: true });
    }

    try {
      const qrRes = await fetchJson(`${botUrl}/api/qr`, 6000);
      if (qrRes.data?.connected) {
        return statusFromPayload({ connected: true });
      }
      return statusFromPayload({
        connected: false,
        connecting: Boolean(health.data?.connecting),
        qr: qrRes.data?.qr || null,
        error: qrRes.data?.error || null,
        needsUpdate: health.status === 200 && !health.data?.connecting,
      });
    } catch {
      return statusFromPayload({
        connected: false,
        connecting: Boolean(health.data?.connecting),
        error: health.status === 200
          ? 'Bot à mettre à jour sur Bothosting — redémarrez le serveur, puis cliquez sur Générer le QR.'
          : 'Cliquez sur « Générer le QR » pour afficher le code.',
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
  if (!botUrl) throw botError('URL du bot non configurée', 400);

  const routes = { start: '/api/start', stop: '/api/stop', logout: '/api/logout' };
  const path = routes[action];
  if (!path) throw botError(`Action inconnue: ${action}`, 400);

  let res;
  try {
    res = await requestJson(`${botUrl}${path}`, {
      method: 'POST',
      body,
      timeoutMs: action === 'logout' ? 10000 : 8000,
    });
  } catch (e) {
    throw botError(e.message || 'Bot injoignable depuis Vercel', e.status || 502);
  }

  if (res.status === 404) {
    throw botError(
      'Bot pas à jour sur Bothosting — redémarrez le serveur (Stop puis Start) pour récupérer le dernier code, puis réessayez.',
      502
    );
  }

  if (res.status >= 400) {
    throw botError(res.data?.error || `Bot inaccessible (HTTP ${res.status})`, 502);
  }

  return res.data;
}
