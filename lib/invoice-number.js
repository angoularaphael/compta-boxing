const INVOICE_NUMBER_PATTERNS = [
  /facture\s*(?:n[°º.]?\s*)?([A-Z]{0,3}\s*\d[\w./-]*)/i,
  /(?:n[°º.]\s*)?facture\s*:?\s*([A-Z]{0,3}\s*\d[\w./-]*)/i,
  /\bf[\s.]*n[°º.]?\s*([A-Z]?\s*\d[\w./-]*)/i,
  /ticket\s*(?:n[°º.]?\s*)?(\d[\w./-]*)/i,
  /reçu\s*(?:n[°º.]?\s*)?(\d[\w./-]*)/i,
  /(?:ref|réf|reference)\s*:?\s*([A-Z0-9][\w./-]{1,20})/i,
];

export function normalizeInvoiceNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || s.toLowerCase() === 'null') return null;
  s = s
    .replace(/\s+/g, ' ')
    .replace(/^n[°º.]?\s*/i, '')
    .replace(/^facture\s*/i, '')
    .replace(/^f\s*/i, '')
    .trim()
    .toUpperCase();
  if (!s || s.length < 2 || s.length > 40) return null;
  return s;
}

export function extractInvoiceNumberFromText(text) {
  const normalized = String(text || '');
  for (const re of INVOICE_NUMBER_PATTERNS) {
    const m = normalized.match(re);
    if (m?.[1]) {
      const num = normalizeInvoiceNumber(m[1]);
      if (num) return num;
    }
  }
  return null;
}

export function extractInvoiceNumberFromFileName(fileName) {
  const name = String(fileName || '');
  const fromName = extractInvoiceNumberFromText(name);
  if (fromName) return fromName;
  const m = name.match(/(?:^|[-_\s])(\d{2,6})(?:[-_\s.]|$)/);
  if (m?.[1]) return normalizeInvoiceNumber(m[1]);
  return null;
}
