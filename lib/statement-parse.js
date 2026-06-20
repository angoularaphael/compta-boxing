import { extractDatesFromText, parseFrenchAmount } from './extract-invoice.js';

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

function extractDebitAmount(line) {
  const neg = line.match(/-\s*(\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2})/);
  if (neg) return parseFrenchAmount(neg[1]);
  const debit = line.match(/(\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2})\s*(?:db|d\b|debit)/i);
  if (debit) return parseFrenchAmount(debit[1]);
  const amounts = [...line.matchAll(/(\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2})/g)].map((m) =>
    parseFrenchAmount(m[1])
  );
  if (line.includes('-') && amounts.length) return amounts[amounts.length - 1];
  return null;
}

export function parseBankStatementText(text) {
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const transactions = [];
  const seen = new Set();

  for (const line of lines) {
    if (/solde|total|report|credit|crédit|recapitulatif|récapitulatif/i.test(line) && !/\d{1,2}[/.-]\d{1,2}/.test(line)) {
      continue;
    }

    const txDate = parseLineDate(line);
    const amount = extractDebitAmount(line);
    if (!txDate || amount == null || amount <= 0) continue;

    let label = line
      .replace(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g, '')
      .replace(/-\s*\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2}/g, '')
      .replace(/\d{1,3}(?:[ \u00a0]\d{3})*[,.]\d{2}/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!label || label.length < 2) label = 'Dépense';

    const key = `${txDate}|${amount}|${normalizeLabel(label)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    transactions.push({
      txDate,
      label,
      amount,
    });
  }

  return transactions;
}

export async function parseBankStatementFile(buffer, mimeType, fileName = '') {
  const mime = String(mimeType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  let text = '';

  if (mime.includes('csv') || name.endsWith('.csv')) {
    text = buffer.toString('utf8');
    return parseCsvStatement(text);
  }

  const pdf = (await import('pdf-parse')).default;
  try {
    const result = await pdf(buffer);
    text = result.text || '';
  } catch {
    text = buffer.toString('utf8');
  }

  return parseBankStatementText(text);
}

function parseCsvStatement(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const transactions = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(/[;,]/).map((p) => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 3) continue;
    const txDate = parseLineDate(parts.join(' ')) || parseLineDate(parts[0]);
    const amountRaw = parts.find((p) => /-?\d+[,.]\d{2}/.test(p)) || parts[parts.length - 1];
    const amount = Math.abs(parseFrenchAmount(amountRaw) || 0);
    const label = parts.find((p) => p.length > 3 && !/^\d/.test(p)) || 'Dépense';
    if (txDate && amount > 0) {
      transactions.push({ txDate, label, amount });
    }
  }
  return transactions;
}
