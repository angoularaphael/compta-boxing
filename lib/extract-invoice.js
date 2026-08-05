import {
  extractInvoiceNumberFromFileName,
  extractInvoiceNumberFromText,
  normalizeInvoiceNumber,
} from './invoice-number.js';

const DATE_PATTERNS = [
  /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/g,
  /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})(?!\d)/g,
];

const AMOUNT_KEYWORDS = /total\s*t\.?\s*t\.?\s*c\.?|net\s*[àa]\s*payer|montant\s*ttc|amount\s*due/i;

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

function lastDayOfMonth(year, month) {
  const d = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return parseFrenchDate(d, month, year);
}

/** Période "Du 01/09/25 AU 30/09/25" ou mois "novembre 2025" → date facture. */
export function extractPeriodOrMonthDate(text) {
  const t = String(text || '');

  const period = t.match(
    /du\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s+(?:au|AU|à|a)\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i
  );
  if (period) {
    return parseFrenchDate(period[4], period[5], period[6]);
  }

  const monthRe =
    /\b(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+(\d{4})\b/i;
  const m = t.match(monthRe);
  if (m) {
    const key = m[1]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const monthMap = {
      janvier: 1,
      fevrier: 2,
      mars: 3,
      avril: 4,
      mai: 5,
      juin: 6,
      juillet: 7,
      aout: 8,
      septembre: 9,
      octobre: 10,
      novembre: 11,
      decembre: 12,
    };
    const month = monthMap[key];
    const year = parseInt(m[2], 10);
    if (month && year) return lastDayOfMonth(year, month);
  }

  return null;
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

  const invoiceDate =
    extractPeriodOrMonthDate(normalized) || extractDatesFromText(normalized)[0] || null;

  let amountTtc = null;
  for (let i = 0; i < lines.length; i++) {
    if (AMOUNT_KEYWORDS.test(lines[i])) {
      const nearby = [];
      const onLine = extractAmountsFromText(lines[i]);
      nearby.push(...onLine);
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        nearby.push(...extractAmountsFromText(lines[j]));
      }
      if (nearby.length) {
        // Sur ces factures Google Sheets, HT/TVA/TTC sont listés après le label → prendre le max
        amountTtc = Math.max(...nearby);
        break;
      }
    }
  }

  if (amountTtc == null) {
    const all = extractAmountsFromText(normalized);
    if (all.length) amountTtc = Math.max(...all);
  }

  let vendorName = null;
  for (const line of lines.slice(0, 12)) {
    if (line.length < 3 || line.length > 80) continue;
    if (/facture|invoice|date|siret|tva|échéance|operation|opération|prestation|libell|management|présidence|periode|période|description|total|iban|swift|bic|client|destinataire|observations|conditions/i.test(line)) {
      continue;
    }
    if (/boxing\s*center|sas\s*boxing/i.test(line)) continue;
    if (/^\d|^(tel|tél|email|http|www\.|fr\d{2}|du\s+\d)/i.test(line)) continue;
    vendorName = line;
    break;
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
    ocrRaw: normalized.replace(/\u0000/g, '').slice(0, 8000),
  };
}
