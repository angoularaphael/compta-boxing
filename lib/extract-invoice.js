import {
  extractInvoiceNumberFromFileName,
  extractInvoiceNumberFromText,
  normalizeInvoiceNumber,
} from './invoice-number.js';

const DATE_PATTERNS = [
  /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/g,
  /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})(?!\d)/g,
];

const AMOUNT_KEYWORDS = /total\s*ttc|net\s*[àa]\s*payer|montant\s*ttc|amount\s*due/i;

export function parseFrenchAmount(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s/g, '').replace('€', '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function parseFrenchDate(day, month, year) {
  let y = parseInt(year, 10);
  if (y < 100) y += 2000;
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return iso;
}

export function extractDatesFromText(text) {
  const found = [];
  for (const re of DATE_PATTERNS) {
    const copy = new RegExp(re.source, re.flags);
    let m;
    while ((m = copy.exec(text)) !== null) {
      const iso = parseFrenchDate(m[1], m[2], m[3]);
      if (iso) found.push(iso);
    }
  }
  return found;
}

export function extractAmountsFromText(text) {
  const amounts = [];
  const re = /(\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2})\s*€?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const val = parseFrenchAmount(m[1]);
    if (val != null && val > 0) amounts.push(val);
  }
  return amounts;
}

export function extractInvoiceFields(text) {
  const normalized = String(text || '').replace(/\r/g, '\n');
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);

  const dates = extractDatesFromText(normalized);
  const invoiceDate = dates[0] || null;

  let amountTtc = null;
  for (let i = 0; i < lines.length; i++) {
    if (AMOUNT_KEYWORDS.test(lines[i])) {
      const onLine = extractAmountsFromText(lines[i]);
      if (onLine.length) {
        amountTtc = onLine[onLine.length - 1];
        break;
      }
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = extractAmountsFromText(lines[j]);
        if (next.length) {
          amountTtc = next[next.length - 1];
          break;
        }
      }
      if (amountTtc != null) break;
    }
  }

  if (amountTtc == null) {
    const all = extractAmountsFromText(normalized);
    if (all.length) amountTtc = Math.max(...all);
  }

  let vendorName = null;
  for (const line of lines.slice(0, 8)) {
    if (line.length >= 3 && line.length <= 80 && !/facture|invoice|date|siret|tva/i.test(line)) {
      vendorName = line;
      break;
    }
  }

  const status =
    invoiceDate && amountTtc != null ? 'ok' : invoiceDate || amountTtc != null ? 'partial' : 'failed';

  const invoiceNumber = extractInvoiceNumberFromText(normalized);

  return {
    invoiceDate,
    amountTtc,
    vendorName,
    invoiceNumber,
    ocrStatus: status,
    ocrRaw: normalized.slice(0, 8000),
  };
}
