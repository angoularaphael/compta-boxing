import { extractTextFromPdf } from './ocr.js';
import { parseFrenchAmount } from './extract-invoice.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const INVOICE_JSON_PROMPT = `Tu analyses une facture d'achat (France).
Réponds UNIQUEMENT en JSON valide avec ces clés :
{
  "invoice_date": "YYYY-MM-DD ou null",
  "amount_ttc": nombre décimal TTC en euros ou null,
  "vendor_name": "nom du fournisseur ou null"
}
Règles : date au format ISO, montant TTC (pas HT), fournisseur = enseigne émettrice.`;

function groqApiKey() {
  return String(process.env.GROQ_API_KEY || '').trim();
}

function visionModel() {
  return process.env.GROQ_VISION_MODEL || 'llama-3.2-90b-vision-preview';
}

function textModel() {
  return process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';
}

function parseIsoDate(value) {
  if (!value || value === 'null') return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : s;
}

function normalizeGroqResult(parsed, rawText = '') {
  const invoiceDate = parseIsoDate(parsed?.invoice_date);
  const amountTtc = parseFrenchAmount(parsed?.amount_ttc);
  const vendorName = parsed?.vendor_name
    ? String(parsed.vendor_name).trim().slice(0, 200)
    : null;

  let ocrStatus = 'failed';
  if (invoiceDate && amountTtc != null) ocrStatus = 'ok';
  else if (invoiceDate || amountTtc != null || vendorName) ocrStatus = 'partial';

  return {
    invoiceDate,
    amountTtc,
    vendorName,
    ocrStatus,
    ocrRaw: rawText.slice(0, 8000),
    analyzer: 'groq',
  };
}

async function groqChat(messages, model) {
  const key = groqApiKey();
  if (!key) throw new Error('GROQ_API_KEY manquant');

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `Groq HTTP ${res.status}`;
    throw new Error(msg);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Réponse Groq vide');

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('JSON Groq invalide');
  }
}

export function isGroqConfigured() {
  return Boolean(groqApiKey());
}

export async function analyzeInvoiceWithGroq(buffer, mimeType, fileName = '') {
  const mime = String(mimeType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  const isPdf = mime.includes('pdf') || name.endsWith('.pdf');

  if (isPdf) {
    const text = await extractTextFromPdf(buffer);
    if (!text || text.length < 20) {
      throw new Error('PDF sans texte extractible pour Groq');
    }
    const parsed = await groqChat(
      [
        { role: 'system', content: INVOICE_JSON_PROMPT },
        {
          role: 'user',
          content: `Texte extrait de la facture PDF :\n\n${text.slice(0, 12000)}`,
        },
      ],
      textModel()
    );
    return normalizeGroqResult(parsed, text);
  }

  const isImage =
    mime.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/i.test(name);
  if (!isImage) {
    throw new Error('Type de fichier non supporté pour Groq vision');
  }

  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`;

  const parsed = await groqChat(
    [
      { role: 'system', content: INVOICE_JSON_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extrais les informations de cette facture.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    visionModel()
  );

  return normalizeGroqResult(parsed, JSON.stringify(parsed));
}
