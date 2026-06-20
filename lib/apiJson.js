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
  return NextResponse.json({ error: err?.message || fallback }, { status });
}
