import { NextResponse } from 'next/server';

export async function parseApiJson(res) {
  const raw = await res.text();
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error('Réponse serveur illisible (JSON invalide).');
    }
  }
  throw new Error(trimmed.slice(0, 200) || `Erreur HTTP ${res.status}`);
}

export function apiError(err, fallback = 'Erreur serveur') {
  const status = err?.status || 500;
  return NextResponse.json({ error: describeError(err) || fallback }, { status });
}

export function describeError(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string' && err.message) {
    const extra = [err.details, err.hint].filter(Boolean).join(' — ');
    return extra ? `${err.message} — ${extra}` : err.message;
  }
  if (typeof err.error === 'string') return err.error;
  if (err.error?.message) return err.error.message;
  try {
    return JSON.stringify(err);
  } catch {
    return '';
  }
}
