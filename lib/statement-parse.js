import { extractDatesFromText, parseFrenchAmount } from './extract-invoice.js';
import { isGroqConfigured, parseBankStatementWithGroq } from './groq-statement.js';

const CREDIT_HINTS =
  /virement\s+recu|virement\s+reçu|remise\s+de\s+cheque|remise\s+de\s+chèque|encaissement|salaire|paye\s+recue|vir\s+sepa\s+recu|vir\s+sepa\s+reçu/i;
const SKIP_LINE =
  /^(solde|total|report|nouveau\s+solde|ancien\s+solde|récapitulatif|recapitulatif|page\s+\d)/i;

/** Coupe le relevé avant la section crédits / solde créditeur. */
export function truncateAtCreditSection(text) {
  const raw = String(text || '');
  const markers = [
    /\bSOLDE\s+CR[ÉE]DITEUR\b/i,
    /\bDETAIL\s+DES\s+OPERATIONS\s+CR[ÉE]DIT/i,
    /\bOPERATIONS?\s+CR[ÉE]DIT(EUR|RICES)?\b/i,
    /\bCR[ÉE]DITS?\s+DU\s+MOIS\b/i,
    /\bMOUVEMENTS?\s+CR[ÉE]DITEURS?\b/i,
  ];
  let cut = raw.length;
  for (const re of markers) {
    const m = raw.match(re);
    if (m?.index != null && m.index > 80 && m.index < cut) cut = m.index;
  }
  return raw.slice(0, cut);
}

function parseLineDate(text) {
  const dates = extractDatesFromText(text);
  return dates[0] || null;
}

function extractAmountsFromLine(line) {
  return [...line.matchAll(/(\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2}|\d+[,.]\d{2})/g)]
    .map((m) => parseFrenchAmount(m[1]))
    .filter((n) => n != null && n > 0);
}

function extractDebitAmount(line) {
  if (CREDIT_HINTS.test(line)) return null;

  const neg = line.match(/[-−]\s*(\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2}|\d+[,.]\d{2})/);
  if (neg) return parseFrenchAmount(neg[1]);

  const debitTag = line.match(
    /(\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2}|\d+[,.]\d{2})\s*(?:DB|D|DEBIT|DÉBIT)\b/i
  );
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
    .replace(/\d+[,.]\d{2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label || label.length < 2) label = txDate ? `Dépense ${txDate}` : 'Dépense';
  return label.slice(0, 200);
}

/** Conserve toutes les lignes, y compris les doublons date/montant/libellé. */
function pushTransaction(transactions, txDate, label, amount) {
  if (!txDate || amount == null || amount <= 0) return;
  transactions.push({ txDate, label: String(label || 'Dépense').slice(0, 200), amount });
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

/** Banque Populaire — format « DD/MMLIBELLE…DD/MMDD/MM- montant € » */
const BP_DEBIT_LINE =
  /^(\d{2}\/\d{2})(.+?)(\d{2}\/\d{2})(\d{2}\/\d{2})-\s*([\d \u00a0]+,\d{2})\s*€/gm;

export function isBanquePopulaireFormat(text) {
  return /Banque Populaire/i.test(text) && /DETAIL DES OPERATIONS/i.test(text);
}

export function inferStatementContext(text) {
  const patterns = [
    /RELEVE\s+N[°º.]?\s*\d+\s+AU\s+(\d{2})\/(\d{2})\/(\d{4})/i,
    /relevé de compte n°\d+ au (\d{2})\/(\d{2})\/(\d{4})/i,
    /SOLDE CREDITEUR AU (\d{2})\/(\d{2})\/(\d{4})/i,
    /SOLDE CRÉDITEUR AU (\d{2})\/(\d{2})\/(\d{4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      return { year: parseInt(m[3], 10), endMonth: parseInt(m[2], 10), endDay: parseInt(m[1], 10) };
    }
  }
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return { year: parseInt(m[3], 10), endMonth: parseInt(m[2], 10), endDay: parseInt(m[1], 10) };
  const y = new Date().getFullYear();
  return { year: y, endMonth: 12, endDay: 31 };
}

function ddMmToIso(day, month, ctx) {
  let year = ctx.year;
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  if (m === 12 && ctx.endMonth <= 2) year -= 1;
  else if (m > ctx.endMonth + 3) year -= 1;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function cleanBpLabel(raw) {
  let label = String(raw || '').trim();
  if (/^CHEQUE/i.test(label)) return 'CHEQUE';
  if (/^PRLV SEPA/i.test(label)) {
    return label.replace(/[0-9A-Z]{5,}$/i, '').trim().slice(0, 200) || 'PRLV SEPA';
  }
  if (/^VIR INST/i.test(label)) {
    return label.replace(/[0-9A-Z]{6,}$/i, '').trim().slice(0, 200) || 'VIR INST';
  }
  if (/^EUROVIR/i.test(label)) {
    return label.replace(/\d{5,}$/i, '').trim().slice(0, 200) || 'EUROVIR';
  }
  label = label.replace(/[0-9A-Z]{5,}$/i, '').trim();
  label = label.replace(/\s+/g, ' ');
  return label.slice(0, 200) || 'Dépense';
}

export function parseBanquePopulaireStatement(text) {
  const ctx = inferStatementContext(text);
  const debitText = truncateAtCreditSection(text);
  const transactions = [];
  const re = new RegExp(BP_DEBIT_LINE.source, 'gm');
  let m;
  while ((m = re.exec(debitText)) !== null) {
    const [day, month] = m[1].split('/');
    const txDate = ddMmToIso(day, month, ctx);
    const label = cleanBpLabel(m[2]);
    const amount = parseFrenchAmount(m[5]);
    pushTransaction(transactions, txDate, label, amount);
  }
  return transactions;
}

export function parseBankStatementText(text) {
  if (isBanquePopulaireFormat(text)) {
    const bp = parseBanquePopulaireStatement(text);
    if (bp.length > 0) return bp;
  }

  const debitText = truncateAtCreditSection(text);
  const lines = String(debitText || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const transactions = [];
  let pendingDate = null;
  let pendingLabel = '';

  for (const line of lines) {
    if (/solde\s+cr[ée]diteur/i.test(line)) break;
    if (SKIP_LINE.test(line)) continue;
    if (/solde|total|report/i.test(line) && !/\d{1,2}[/.-]\d{1,2}/.test(line)) continue;

    const txDate = parseLineDate(line);
    const amount = extractDebitAmount(line);

    if (txDate && amount != null) {
      pushTransaction(transactions, txDate, cleanLabel(line, txDate), amount);
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
      pushTransaction(transactions, pendingDate, cleanLabel(combined, pendingDate), amount);
      pendingDate = null;
      pendingLabel = '';
      continue;
    }

    if (!txDate && amount != null && /\d{1,2}[/.-]\d{1,2}/.test(pendingLabel)) {
      const d = parseLineDate(pendingLabel);
      if (d) {
        pushTransaction(transactions, d, cleanLabel(`${pendingLabel} ${line}`, d), amount);
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

  let transactions = [];
  if (isBanquePopulaireFormat(text)) {
    transactions = parseBanquePopulaireStatement(text);
  }
  if (transactions.length < 3) {
    transactions = parseBankStatementText(text);
  }

  const useGroq =
    isGroqConfigured() &&
    String(text).length > 80 &&
    transactions.length < 5;

  if (useGroq) {
    try {
      const groqTxs = await parseBankStatementWithGroq(truncateAtCreditSection(text));
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

  for (const line of lines.slice(1)) {
    const parts = line.split(/[;,]/).map((p) => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 2) continue;
    const joined = parts.join(' ');
    const txDate = parseLineDate(joined) || parseLineDate(parts[0]);
    const amountRaw = parts.find((p) => /-?\d+[,.]\d{2}/.test(p)) || parts[parts.length - 1];
    let amount = parseFrenchAmount(amountRaw);
    if (amount != null && amount < 0) amount = Math.abs(amount);
    const label =
      parts.find((p) => p.length > 3 && !/^\d/.test(p) && !/^-?\d+[,.]\d{2}$/.test(p)) || 'Dépense';
    if (txDate && amount != null && amount > 0) {
      pushTransaction(transactions, txDate, label, amount);
    }
  }
  return transactions;
}
