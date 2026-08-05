import { extractTextFromPdf, extractTextFromImage } from './ocr.js';
import { extractInvoiceFields, parseFrenchAmount } from './extract-invoice.js';
import { extractEmbeddedJpegFromPdf } from './pdf-image.js';
import {
  extractInvoiceNumberFromFileName,
  extractInvoiceNumberFromText,
  normalizeInvoiceNumber,
} from './invoice-number.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** Llama 4 Scout a été retiré (17/07/2026). qwen3.6 garde la vision ; gpt-oss pour le texte. */
const DEFAULT_VISION_MODEL = 'qwen/qwen3.6-27b';
const DEFAULT_TEXT_MODEL = 'openai/gpt-oss-120b';

const INVOICE_JSON_PROMPT = `Extrais les infos de ce justificatif français (facture, ticket de caisse ou carburant) en JSON strict :
{
  "invoice_date": "YYYY-MM-DD ou null",
  "amount_ttc": nombre décimal ou null,
  "vendor_name": "string ou null",
  "invoice_number": "string ou null"
}

Règles STRICTES :
- invoice_date en ISO (ex. 23/06/2026 → 2026-06-23)
- amount_ttc = Total TTC / Net à payer / TOT TTC — nombre sans symbole €
- vendor_name = ÉMETTEUR (celui qui facture / doit être payé), JAMAIS le client
- BOXING CENTER, SAS BOXING CENTER, MINIMES, RAMONVILLE, SAINT CYPRIEN = CLIENT → pas vendor_name
- Ex. "Fanny LALOGE" + "SAS BOXING CENTER MINIMES" → vendor_name = "Fanny LALOGE"
- Ex. "TEYCHENE UGO" + "BOXING CENTER" → vendor_name = "TEYCHENE UGO"
- invoice_number = n° facture / ticket (ex. "2026-06-1", "2-2", "F00007") ; sinon null
- Réponds UNIQUEMENT le JSON, sans autre texte`;

function groqApiKey() {
  return String(process.env.GROQ_API_KEY || '').trim();
}

function visionModel() {
  return process.env.GROQ_VISION_MODEL || DEFAULT_VISION_MODEL;
}

function textModel() {
  return process.env.GROQ_TEXT_MODEL || DEFAULT_TEXT_MODEL;
}

function sanitizeExtractedText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2000-\u200b\u202f\ufeff]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
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

function isBoxingCenterClientName(name) {
  return /boxing\s*center|sas\s*boxing|\bminimes\b|\bramonville\b|saint[-\s]?cyprien/i.test(
    String(name || '')
  );
}

function resolveInvoiceNumber(parsed, rawText = '', fileName = '') {
  const fromGroq = normalizeInvoiceNumber(parsed?.invoice_number);
  if (fromGroq) return fromGroq;
  const fromText = extractInvoiceNumberFromText(rawText);
  if (fromText) return fromText;
  return extractInvoiceNumberFromFileName(fileName);
}

/** Si le modèle a pris le client pour vendor, cherche un autre nom dans le texte. */
function correctVendorName(vendorName, rawText = '') {
  let name = vendorName ? String(vendorName).trim().slice(0, 200) : null;
  if (!name || !isBoxingCenterClientName(name)) return name;

  const lines = String(rawText)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 12)) {
    if (line.length < 3 || line.length > 80) continue;
    if (/facture|invoice|date|siret|tva|échéance|client|destinataire/i.test(line)) continue;
    if (isBoxingCenterClientName(line)) continue;
    if (/^\d|^(tel|tél|email|iban|swift|bic|http)/i.test(line)) continue;
    return line.slice(0, 200);
  }
  return name;
}

function normalizeGroqResult(parsed, rawText = '', fileName = '') {
  const invoiceDate = parseIsoDate(parsed?.invoice_date);
  const amountTtc = parseFrenchAmount(parsed?.amount_ttc);
  const vendorName = correctVendorName(
    parsed?.vendor_name ? String(parsed.vendor_name).trim().slice(0, 200) : null,
    rawText
  );
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

function extractJsonObject(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* continue */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

async function groqChat(messages, model, { jsonMode = true } = {}) {
  const key = groqApiKey();
  if (!key) throw new Error('GROQ_API_KEY manquant');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  const payload = {
    model,
    messages,
    temperature: 0,
  };
  if (jsonMode) payload.response_format = { type: 'json_object' };

  let res;
  try {
    res = await fetch(GROQ_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Groq timeout (45s)');
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const failed = body?.error?.failed_generation;
    if (failed) {
      const recovered = extractJsonObject(failed);
      if (recovered) return recovered;
    }
    const msg = body?.error?.message || body?.message || `Groq HTTP ${res.status}`;
    throw new Error(msg);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Réponse Groq vide');

  const parsed = extractJsonObject(content);
  if (!parsed) throw new Error('JSON Groq invalide');
  return parsed;
}

function localTextFallback(clean, fileName) {
  const local = extractInvoiceFields(clean);
  return normalizeGroqResult(
    {
      invoice_date: local.invoiceDate,
      amount_ttc: local.amountTtc,
      vendor_name: local.vendorName,
      invoice_number: local.invoiceNumber,
    },
    clean,
    fileName
  );
}

async function analyzeTextWithGroq(text, fileName) {
  const clean = sanitizeExtractedText(text);
  if (!clean || clean.length < 8) {
    throw new Error('Texte insuffisant pour analyse Groq');
  }

  const userMsg = `${INVOICE_JSON_PROMPT}\n\nTexte extrait :\n\n${clean.slice(0, 12000)}`;
  const models = [...new Set([textModel(), DEFAULT_TEXT_MODEL, 'llama-3.3-70b-versatile'])];

  for (const model of models) {
    try {
      const parsed = await groqChat([{ role: 'user', content: userMsg }], model);
      const result = normalizeGroqResult(parsed, clean, fileName);
      if (result.ocrStatus !== 'failed') return result;
    } catch (err) {
      console.warn(`[groq-invoice] texte ${model} échoué:`, err.message);
      try {
        const parsed = await groqChat([{ role: 'user', content: userMsg }], model, {
          jsonMode: false,
        });
        const result = normalizeGroqResult(parsed, clean, fileName);
        if (result.ocrStatus !== 'failed') return result;
      } catch (err2) {
        console.warn(`[groq-invoice] texte ${model} sans jsonMode:`, err2.message);
      }
    }
  }

  // PDF avec texte extractible : parsing local déterministe (ex. Fanny LALOGE)
  const fallback = localTextFallback(clean, fileName);
  if (fallback.ocrStatus !== 'failed') {
    return { ...fallback, analyzer: 'local-text' };
  }
  throw new Error('Analyse texte Groq + local échouée');
}

async function analyzeImageBufferWithGroq(buffer, mimeType, fileName, hint = '') {
  const base64 = buffer.toString('base64');
  const safeMime =
    mimeType && String(mimeType).startsWith('image/')
      ? mimeType
      : 'image/jpeg';
  const dataUrl = `data:${safeMime};base64,${base64}`;

  try {
    const parsed = await groqChat(
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: hint
                ? `${INVOICE_JSON_PROMPT}\n\n${hint}`
                : INVOICE_JSON_PROMPT,
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      visionModel()
    );
    return normalizeGroqResult(parsed, JSON.stringify(parsed), fileName);
  } catch (visionErr) {
    console.warn('[groq-invoice] Vision échouée, fallback OCR→texte:', visionErr.message);
    const ocrText = await extractTextFromImage(buffer);
    if (ocrText && ocrText.length >= 12) {
      return analyzeTextWithGroq(ocrText, fileName);
    }
    throw visionErr;
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
    const text = sanitizeExtractedText(await extractTextFromPdf(buffer));
    if (text && text.length >= 20) {
      return analyzeTextWithGroq(text, fileName);
    }

    const jpeg = extractEmbeddedJpegFromPdf(buffer);
    if (jpeg) {
      return analyzeImageBufferWithGroq(
        jpeg,
        'image/jpeg',
        fileName,
        'Document scanné (PDF CamScanner). Peut être une facture ou un ticket carburant.'
      );
    }

    throw new Error('PDF sans texte ni image extractible pour Groq');
  }

  const isImage =
    mime.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/i.test(name);
  if (!isImage) {
    throw new Error('Type de fichier non supporté pour Groq vision');
  }

  const resolvedMime =
    mime.startsWith('image/')
      ? mime
      : name.endsWith('.webp')
        ? 'image/webp'
        : name.endsWith('.png')
          ? 'image/png'
          : 'image/jpeg';

  return analyzeImageBufferWithGroq(buffer, resolvedMime, fileName);
}
