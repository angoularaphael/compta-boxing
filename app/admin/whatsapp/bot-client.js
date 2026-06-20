/**
 * Appels directs navigateur → bot Bothosting (contourne le timeout Vercel → us2).
 */

async function readBotJson(res) {
  const raw = await res.text();
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error('Réponse bot illisible');
    }
  }
  throw new Error(trimmed.slice(0, 160) || `Erreur HTTP ${res.status}`);
}

export async function fetchBotStatusDirect(botUrl) {
  if (!botUrl) {
    return {
      configured: false,
      connected: false,
      connecting: false,
      qr: null,
      error: 'URL du bot non configurée.',
      qrError: null,
    };
  }

  try {
    const res = await fetch(`${botUrl}/api/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const data = await readBotJson(res);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return {
      configured: true,
      connected: Boolean(data.connected),
      connecting: Boolean(data.connecting),
      qr: data.qr || null,
      error: data.qrError || null,
      qrError: data.qrError || null,
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      connecting: false,
      qr: null,
      error: err.message || 'Bot inaccessible',
      qrError: null,
    };
  }
}

export async function postBotActionDirect(botUrl, action) {
  const paths = { start: '/api/start', stop: '/api/stop', logout: '/api/logout' };
  const path = paths[action];
  if (!path || !botUrl) throw new Error('Bot non configuré');

  const res = await fetch(`${botUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'qr' }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await readBotJson(res);
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
