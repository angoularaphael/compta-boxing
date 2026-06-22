import { parseFrenchAmount } from './extract-invoice.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const STATEMENT_JSON_PROMPT = `Tu analyses un relevé bancaire français (PDF texte extrait).
Extrais UNIQUEMENT les dépenses / débits (argent qui sort du compte).
Ignore : virements reçus, salaires, remises, crédits, intérêts créditeurs, soldes.

Réponds en JSON :
{
  "transactions": [
    { "date": "YYYY-MM-DD", "label": "libellé court", "amount": 12.34 }
  ]
}
Règles :
- amount = montant positif en euros (débit uniquement)
- date ISO ; formats FR DD/MM/YYYY convertis
- cartes, prélèvements, chèques, frais bancaires = dépenses
- ne duplique pas les lignes`;

function groqApiKey() {
  return String(process.env.GROQ_API_KEY || '').trim();
}

function textModel() {
  return process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';
}

function parseIsoDate(value) {
  if (!value || value === 'null') return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const dt = new Date(s);
    return Number.isNaN(dt.getTime()) ? null : s;
  }
  const fr = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (fr) {
    const iso = `${fr[3]}-${String(fr[2]).padStart(2, '0')}-${String(fr[1]).padStart(2, '0')}`;
    const dt = new Date(iso);
    return Number.isNaN(dt.getTime()) ? null : iso;
  }
  return null;
}

export function isGroqConfigured() {
  return Boolean(groqApiKey());
}

export async function parseBankStatementWithGroq(text) {
  const key = groqApiKey();
  if (!key) throw new Error('GROQ_API_KEY manquant');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);

  let res;
  try {
    res = await fetch(GROQ_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: textModel(),
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: STATEMENT_JSON_PROMPT },
          {
            role: 'user',
            content: `Texte du relevé bancaire :\n\n${String(text).slice(0, 28000)}`,
          },
        ],
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Groq timeout relevé');
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || `Groq HTTP ${res.status}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) return [];

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const rows = Array.isArray(parsed?.transactions) ? parsed.transactions : [];
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    const txDate = parseIsoDate(row?.date);
    const amount = parseFrenchAmount(row?.amount);
    const label = String(row?.label || 'Dépense').trim().slice(0, 200);
    if (!txDate || amount == null || amount <= 0) continue;
    const key = `${txDate}|${amount}|${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ txDate, label, amount });
  }

  return out;
}
