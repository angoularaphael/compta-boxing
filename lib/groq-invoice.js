import { extractTextFromPdf } from './ocr.js';
import { parseFrenchAmount } from './extract-invoice.js';
import { extractEmbeddedJpegFromPdf } from './pdf-image.js';
import {
  extractInvoiceNumberFromFileName,
  extractInvoiceNumberFromText,
  normalizeInvoiceNumber,
} from './invoice-number.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const INVOICE_JSON_PROMPT = `Tu analyses un justificatif d'achat français : facture, ticket de caisse ou ticket carburant (Esso, Total, Shell, etc.).
Réponds UNIQUEMENT en JSON valide avec ces clés :
{
  "invoice_date": "YYYY-MM-DD ou null",
  "amount_ttc": nombre décimal TTC en euros ou null,
  "vendor_name": "nom du fournisseur / enseigne / station ou null",
  "invoice_number": "numéro de facture, ticket ou référence ou null"
}
Règles :
- date au format ISO (date sur le ticket, ex. 21-06-2026 → 2026-06-21)
- amount_ttc = montant TTC payé : cherche "TOT TTC", "TOT.TTC", "TOTAL", "Net à payer", montant carte
- vendor_name = enseigne en tête du ticket (ex. "ESSO EXPRESS AUCAMVILLE")
- invoice_number = numéro de facture OU "N° TICKET" / "N° ticket" (ex. 2663530219) ; sinon null
- ticket carburant : date + montant TTC suffisent pour une bonne analyse
- photo floue : extrais ce qui est lisible, ne mets pas tout à null`;

function groqApiKey() {
  return String(process.env.GROQ_API_KEY || '').trim();
}

function visionModel() {
  return process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
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

function resolveInvoiceNumber(parsed, rawText = '', fileName = '') {
  const fromGroq = normalizeInvoiceNumber(parsed?.invoice_number);
  if (fromGroq) return fromGroq;
  const fromText = extractInvoiceNumberFromText(rawText);
  if (fromText) return fromText;
  return extractInvoiceNumberFromFileName(fileName);
}

function normalizeGroqResult(parsed, rawText = '', fileName = '') {
  const invoiceDate = parseIsoDate(parsed?.invoice_date);
  const amountTtc = parseFrenchAmount(parsed?.amount_ttc);
  const vendorName = parsed?.vendor_name
    ? String(parsed.vendor_name).trim().slice(0, 200)
    : null;
  const invoiceNumber = resolveInvoiceNumber(parsed, rawText, fileName);

  let ocrStatus = 'failed';
  if (invoiceDate && amountTtc != null) ocrStatus = 'ok';
  else if (invoiceDate || amountTtc != null || vendorName) ocrStatus = 'partial';

  return {
    invoiceDate,
    amountTtc,
    vendorName,
    invoiceNumber,
    ocrStatus,
    ocrRaw: rawText.slice(0, 8000),
    analyzer: 'groq',
  };
}

async function groqChat(messages, model) {
  const key = groqApiKey();
  if (!key) throw new Error('GROQ_API_KEY manquant');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

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
        model,
        messages,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Groq timeout (45s)');
    throw err;
  } finally {
    clearTimeout(timer);
  }

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

async function analyzeImageBufferWithGroq(buffer, mimeType, fileName, hint = '') {
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`;

  const parsed = await groqChat(
    [
      { role: 'system', content: INVOICE_JSON_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: hint || 'Extrais les informations de ce justificatif (facture ou ticket).',
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    visionModel()
  );

  return normalizeGroqResult(parsed, JSON.stringify(parsed), fileName);
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
    if (text && text.length >= 20) {
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
      return normalizeGroqResult(parsed, text, fileName);
    }

    const jpeg = extractEmbeddedJpegFromPdf(buffer);
    if (jpeg) {
      return analyzeImageBufferWithGroq(
        jpeg,
        'image/jpeg',
        fileName,
        'Document scanné (PDF CamScanner). Peut être une facture ou un ticket carburant — photo de qualité moyenne.'
      );
    }

    throw new Error('PDF sans texte ni image extractible pour Groq');
  }

  const isImage =
    mime.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/i.test(name);
  if (!isImage) {
    throw new Error('Type de fichier non supporté pour Groq vision');
  }

  return analyzeImageBufferWithGroq(buffer, mimeType, fileName);
}
