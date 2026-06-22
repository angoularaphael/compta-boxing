import { extractDatesFromText, parseFrenchAmount } from './extract-invoice.js';
import { isGroqConfigured, parseBankStatementWithGroq } from './groq-statement.js';

const CREDIT_HINTS =
  /virement\s+recu|virement\s+reçu|remise\s+de\s+cheque|remise\s+de\s+chèque|encaissement|crédit\s+créditeur|credit\s+crediteur|salaire|paye\s+recue|vir\s+sepa\s+recu|vir\s+sepa\s+reçu/i;
const SKIP_LINE =
  /^(solde|total|report|nouveau\s+solde|ancien\s+solde|récapitulatif|recapitulatif|page\s+\d)/i;

function normalizeLabel(label) {
  return String(label || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLineDate(text) {
  const dates = extractDatesFromText(text);
  return dates[0] || null;
}

function extractAmountsFromLine(line) {
  return [...line.matchAll(/(\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2})/g)]
    .map((m) => parseFrenchAmount(m[1]))
    .filter((n) => n != null && n > 0);
}

function extractDebitAmount(line) {
  if (CREDIT_HINTS.test(line)) return null;

  const neg = line.match(/[-−]\s*(\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2})/);
  if (neg) return parseFrenchAmount(neg[1]);

  const debitTag = line.match(/(\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2})\s*(?:DB|D|DEBIT|DÉBIT)\b/i);
  if (debitTag) return parseFrenchAmount(debitTag[1]);

  const amounts = extractAmountsFromLine(line);
  if (!amounts.length) return null;

  if (/\b(?:DB|D|DEBIT|DÉBIT)\b/i.test(line)) return amounts[amounts.length - 1];
  if (/(?:carte|paiement|prelevement|prélèvement|cheque|chèque|retrait|frais|commission|cb\s)/i.test(line)) {
    return amounts[amounts.length - 1];
  }

  if (amounts.length >= 2) {
    return amounts[amounts.length - 1];
  }

  if (!CREDIT_HINTS.test(line) && amounts.length === 1 && /\d{1,2}[/.-]\d{1,2}/.test(line)) {
    return amounts[0];
  }

  return null;
}

function cleanLabel(line, txDate) {
  let label = line
    .replace(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g, '')
    .replace(/[-−]\s*\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2}/g, '')
    .replace(/\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label || label.length < 2) label = txDate ? `Dépense ${txDate}` : 'Dépense';
  return label.slice(0, 200);
}

function pushTransaction(transactions, seen, txDate, label, amount) {
  if (!txDate || amount == null || amount <= 0) return;
  const key = `${txDate}|${amount}|${normalizeLabel(label)}`;
  if (seen.has(key)) return;
  seen.add(key);
  transactions.push({ txDate, label: label.slice(0, 200), amount });
}

export function inferAccountingMonthFromTransactions(transactions) {
  if (!transactions?.length) return null;
  const counts = {};
  for (const t of transactions) {
    const ym = String(t.txDate || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) counts[ym] = (counts[ym] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || null;
}

export function parseBankStatementText(text) {
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const transactions = [];
  const seen = new Set();
  let pendingDate = null;
  let pendingLabel = '';

  for (const line of lines) {
    if (SKIP_LINE.test(line)) continue;
    if (/solde|total|report/i.test(line) && !/\d{1,2}[/.-]\d{1,2}/.test(line)) continue;

    const txDate = parseLineDate(line);
    const amount = extractDebitAmount(line);

    if (txDate && amount != null) {
      pushTransaction(transactions, seen, txDate, cleanLabel(line, txDate), amount);
      pendingDate = null;
      pendingLabel = '';
      continue;
    }

    if (txDate && !amount) {
      pendingDate = txDate;
      pendingLabel = line;
      continue;
    }

    if (!txDate && amount != null && pendingDate) {
      const combined = `${pendingLabel} ${line}`.trim();
      pushTransaction(transactions, seen, pendingDate, cleanLabel(combined, pendingDate), amount);
      pendingDate = null;
      pendingLabel = '';
      continue;
    }

    if (!txDate && amount != null && /\d{1,2}[/.-]\d{1,2}/.test(pendingLabel)) {
      const d = parseLineDate(pendingLabel);
      if (d) {
        pushTransaction(transactions, seen, d, cleanLabel(`${pendingLabel} ${line}`, d), amount);
        pendingDate = null;
        pendingLabel = '';
      }
    }
  }

  return transactions;
}

async function extractPdfText(buffer) {
  const pdf = (await import('pdf-parse')).default;
  try {
    const result = await pdf(buffer);
    return result.text || '';
  } catch {
    return buffer.toString('utf8');
  }
}

export async function parseBankStatementFile(buffer, mimeType, fileName = '') {
  const mime = String(mimeType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  let text = '';

  if (mime.includes('csv') || name.endsWith('.csv')) {
    return parseCsvStatement(buffer.toString('utf8'));
  }

  text = await extractPdfText(buffer);
  let transactions = parseBankStatementText(text);

  const useGroq =
    isGroqConfigured() &&
    String(text).length > 80 &&
    (transactions.length < 5 || transactions.length < String(text).length / 800);

  if (useGroq) {
    try {
      const groqTxs = await parseBankStatementWithGroq(text);
      if (groqTxs.length > transactions.length) {
        transactions = groqTxs;
      }
    } catch (err) {
      console.warn('[parseBankStatementFile] Groq fallback:', err.message);
    }
  }

  return transactions;
}

function parseCsvStatement(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const transactions = [];
  const seen = new Set();

  for (const line of lines.slice(1)) {
    const parts = line.split(/[;,]/).map((p) => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 2) continue;
    const joined = parts.join(' ');
    const txDate = parseLineDate(joined) || parseLineDate(parts[0]);
    const amountRaw = parts.find((p) => /-?\d+[,.]\d{2}/.test(p)) || parts[parts.length - 1];
    let amount = parseFrenchAmount(amountRaw);
    if (amount != null && amount < 0) amount = Math.abs(amount);
    const label = parts.find((p) => p.length > 3 && !/^\d/.test(p) && !/^-?\d+[,.]\d{2}$/.test(p)) || 'Dépense';
    if (txDate && amount != null && amount > 0) {
      pushTransaction(transactions, seen, txDate, label, amount);
    }
  }
  return transactions;
}
