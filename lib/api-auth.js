import { getSession } from './session';

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    const err = new Error('Non authentifié');
    err.status = 401;
    throw err;
  }
  return session;
}

export function verifyWebhookSecret(request, expectedSecret) {
  const header = request.headers.get('x-webhook-secret') || '';
  const expected = String(expectedSecret || process.env.WHATSAPP_WEBHOOK_SECRET || '').trim();
  if (!expected) return false;
  return header === expected;
}
