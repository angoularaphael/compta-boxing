import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BOT_URL_ENV_KEYS } from './bot-config.js';

dns.setDefaultResultOrder('ipv4first');

export { BOTS } from './bot-config.js';

export function botUrlFromEnv(slug) {
  const key = BOT_URL_ENV_KEYS[slug];
  const raw = key ? process.env[key] : '';
  return String(raw || '').trim().replace(/\/$/, '');
}

function isValidBotUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname) &&
      Boolean(parsed.port)
    );
  } catch {
    return false;
  }
}

export function botUrlFromLocation(location) {
  const fromDb = String(location?.bot_url || '').trim().replace(/\/$/, '');
  if (isValidBotUrl(fromDb)) return fromDb;
  return botUrlFromEnv(location?.slug);
}

function botHeaders() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'compta-boxing/1.0',
    Connection: 'close',
  };
}

function isTransientNetworkError(message) {
  const msg = String(message || '').toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('abort') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('socket hang up') ||
    msg.includes('network')
  );
}

function botResponse(body, statusCode, statusMessage = '') {
  const text = typeof body === 'string' ? body : '';
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    statusText: statusMessage,
    text: async () => text,
  };
}

async function nodeHttpRequest(url, { method = 'GET', headers = {}, body } = {}, timeoutMs = 20000) {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;
  const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;
  const path = `${parsed.pathname}${parsed.search}`;

  let hostname = parsed.hostname;
  try {
    const resolved = await lookup(parsed.hostname, { family: 4 });
    hostname = resolved.address;
  } catch {
    /* garde le hostname */
  }

  const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
  const reqHeaders = {
    ...headers,
    Host: parsed.host,
    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname,
        port,
        path,
        method,
        headers: reqHeaders,
        family: 4,
        servername: isHttps ? parsed.hostname : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve(botResponse(Buffer.concat(chunks).toString('utf8'), res.statusCode || 0, res.statusMessage || ''));
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy(new Error('timeout'));
    }, timeoutMs);

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.on('close', () => clearTimeout(timer));

    if (payload) req.write(payload);
    req.end();
  });
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  try {
    return await nodeHttpRequest(
      url,
      {
        method: opts.method || 'GET',
        headers: opts.headers || {},
        body: opts.body,
      },
      timeoutMs
    );
  } catch (nodeErr) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } catch {
      throw nodeErr;
    } finally {
      clearTimeout(timer);
    }
  }
}

function isHtmlResponse(text) {
  const t = String(text).trim().toLowerCase();
  return t.startsWith('<!doctype html') || t.startsWith('<html');
}

async function readBotJson(res) {
  const raw = await res.text();
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error('Réponse du bot illisible (JSON invalide).');
    }
  }
  if (isHtmlResponse(trimmed)) {
    throw new Error(
      'Bot inaccessible (page HTML). Vérifiez Bothosting et bot_url (ex. http://us2.bot-hosting.net:21334).'
    );
  }
  throw new Error(trimmed.slice(0, 180) || `Erreur bot HTTP ${res.status}`);
}

function botTimeoutMs(path) {
  if (path === '/api/status') return 6000;
  if (path === '/api/health') return 8000;
  if (path === '/api/qr') return 6000;
  if (path === '/api/start') return 8000;
  if (path === '/api/stop') return 8000;
  if (path === '/api/logout') return 10000;
  return 20000;
}

function unreachableMessage(botUrl, cause) {
  const base = `Bot inaccessible depuis Vercel. Vérifiez bot_url / BOT_URL_* (${botUrl || 'non configuré'}), que Bothosting tourne, puis redéployez.`;
  if (!cause) return base;
  return `${base} (${cause})`;
}

function botError(message, status = 502) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function botFetch(botUrl, path, { method = 'GET', body } = {}, attempt = 0) {
  if (!isValidBotUrl(botUrl)) {
    throw botError('URL du bot invalide ou non configurée', 400);
  }

  const url = `${botUrl}${path}`;
  const timeoutMs = botTimeoutMs(path);
  const opts = {
    method,
    headers: botHeaders(),
    cache: 'no-store',
  };
  if (body) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetchWithTimeout(url, opts, timeoutMs);
  } catch (e) {
    const msg = String(e.message || e);
    const skipRetry = path === '/api/status' || path === '/api/start';
    if (isTransientNetworkError(msg) && attempt < 2 && !skipRetry) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      return botFetch(botUrl, path, { method, body }, attempt + 1);
    }
    if (isTransientNetworkError(msg)) {
      throw botError(unreachableMessage(botUrl, msg), 502);
    }
    throw botError(msg, 502);
  }

  const data = await readBotJson(res);
  if (res.status === 404) {
    throw botError(
      'Bot pas à jour sur Bothosting — redémarrez le serveur (Stop puis Start) pour récupérer le dernier code.',
      502
    );
  }
  if (!res.ok) {
    throw botError(data.error || res.statusText || `Erreur HTTP ${res.status}`, 502);
  }
  return data;
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
  if (!isValidBotUrl(botUrl)) {
    return {
      configured: false,
      connected: false,
      connecting: false,
      qr: null,
      error: 'URL du bot non configurée (Supabase bot_url ou BOT_URL_* sur Vercel).',
    };
  }

  try {
    const data = await botFetch(botUrl, '/api/status');
    return statusFromPayload(data);
  } catch {
    /* ancien bot sans /api/status */
  }

  try {
    const health = await botFetch(botUrl, '/api/health');
    if (health.connected) {
      return statusFromPayload({ ...health, connected: true });
    }

    try {
      const qrData = await botFetch(botUrl, '/api/qr');
      if (qrData.connected) {
        return statusFromPayload({ connected: true });
      }
      return statusFromPayload({
        connected: false,
        connecting: Boolean(health.connecting),
        qr: qrData.qr || null,
        error: qrData.error || null,
      });
    } catch {
      return statusFromPayload({
        connected: false,
        connecting: Boolean(health.connecting),
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
  const routes = {
    start: '/api/start',
    stop: '/api/stop',
    logout: '/api/logout',
  };
  const path = routes[action];
  if (!path) throw botError(`Action inconnue: ${action}`, 400);
  return botFetch(botUrl, path, { method: 'POST', body });
}
