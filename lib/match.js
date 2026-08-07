import Fuse from 'fuse.js';

const DAY_TOLERANCE_STRICT = 5;
const DAY_TOLERANCE_WIDE = 14;

const STOP_WORDS = new Set([
  'prlv',
  'sepa',
  'vir',
  'inst',
  'virement',
  'carte',
  'paiement',
  'cheque',
  'cb',
  'eurovir',
  'frais',
  'commission',
  'retrait',
  'depense',
  'du',
  'de',
  'la',
  'le',
  'les',
  'des',
  'et',
  'au',
  'aux',
  'en',
  'sur',
  'par',
  'pour',
  'sas',
  'sarl',
  'eurl',
  'sci',
  'sa',
]);

export function amountsMatch(a, b, tolerance = 0.02) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

export function datesWithinTolerance(dateA, dateB, days = DAY_TOLERANCE_STRICT) {
  if (!dateA || !dateB) return false;
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  const diff = Math.abs(a.getTime() - b.getTime());
  return diff <= days * 24 * 60 * 60 * 1000;
}

function daysBetween(dateA, dateB) {
  if (!dateA || !dateB) return Infinity;
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Infinity;
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000);
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(str) {
  return normalize(str)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

function resolveVendorName(invoice, aliases) {
  const vendor = normalize(invoice.vendor_name);
  for (const alias of aliases) {
    if (normalize(alias.vendor_name) === vendor) return alias.vendor_name;
  }
  return invoice.vendor_name || '';
}

function tokenOverlapScore(labelTokens, vendorTokens) {
  if (!labelTokens.length || !vendorTokens.length) return 0;
  let hits = 0;
  for (const vt of vendorTokens) {
    if (labelTokens.some((lt) => lt.includes(vt) || vt.includes(lt))) hits += 1;
  }
  return hits / vendorTokens.length;
}

function labelMatchesInvoice(label, invoice, aliases) {
  return labelMatchScore(label, invoice, aliases) >= 0.45;
}

function labelMatchScore(label, invoice, aliases) {
  const normLabel = normalize(label);
  const labelTokens = significantTokens(label);
  const vendorRaw = resolveVendorName(invoice, aliases);
  const vendor = normalize(vendorRaw);
  const vendorTokens = significantTokens(vendorRaw);
  let score = 0;

  if (vendor && vendor.length >= 2) {
    if (normLabel.includes(vendor) || vendor.includes(normLabel)) score = Math.max(score, 0.95);
    const overlap = tokenOverlapScore(labelTokens, vendorTokens);
    score = Math.max(score, overlap);
  }

  for (const alias of aliases) {
    const bank = normalize(alias.bank_label);
    const vend = normalize(alias.vendor_name);
    const invVend = normalize(invoice.vendor_name);
    if (bank && normLabel.includes(bank) && (vend === invVend || vend === vendor)) {
      score = Math.max(score, 0.92);
    }
    const bankTokens = significantTokens(alias.bank_label);
    if (bankTokens.length && (vend === invVend || vend === vendor)) {
      score = Math.max(score, tokenOverlapScore(labelTokens, bankTokens) * 0.9);
    }
  }

  if (invoice.invoice_number) {
    const num = normalize(invoice.invoice_number).replace(/\s+/g, '');
    if (num.length >= 3 && normLabel.replace(/\s+/g, '').includes(num)) {
      score = Math.max(score, 0.9);
    }
  }

  if (vendor && vendor.length >= 3 && score < 0.45) {
    const fuse = new Fuse([{ name: vendor }], { keys: ['name'], threshold: 0.4, includeScore: true });
    const hit = fuse.search(normLabel);
    if (hit.length) {
      const fuseScore = 1 - (hit[0].score || 1);
      score = Math.max(score, fuseScore * 0.85);
    }
  }

  return score;
}

function scorePair(tx, inv, aliases) {
  if (!amountsMatch(tx.amount, inv.amount_ttc)) return null;

  const dayDiff = daysBetween(tx.tx_date, inv.invoice_date);
  const labelScore = labelMatchScore(tx.label, inv, aliases);

  let score = 0.35; // montant égal
  if (dayDiff <= DAY_TOLERANCE_STRICT) score += 0.35 * (1 - dayDiff / (DAY_TOLERANCE_STRICT + 1));
  else if (dayDiff <= DAY_TOLERANCE_WIDE) score += 0.15 * (1 - dayDiff / (DAY_TOLERANCE_WIDE + 1));
  else if (inv.invoice_date) return null; // date trop éloignée
  else score += 0.05; // facture sans date

  score += 0.3 * Math.min(1, labelScore);

  // Bonus si libellé fort + montant
  if (labelScore >= 0.7) score += 0.08;

  return {
    transactionId: tx.id,
    invoiceId: inv.id,
    score: Math.min(0.99, score),
    labelScore,
    dayDiff,
  };
}

export function findAutoMatches(transactions, invoices, aliases = []) {
  const candidates = [];

  for (const tx of transactions) {
    if (tx.matched_invoice_id) continue;
    for (const inv of invoices) {
      const scored = scorePair(tx, inv, aliases);
      if (!scored) continue;
      // Garder les paires raisonnables
      if (scored.score < 0.55 && scored.labelScore < 0.45) continue;
      if (scored.score < 0.7 && scored.dayDiff > DAY_TOLERANCE_STRICT && scored.labelScore < 0.6) {
        continue;
      }
      candidates.push(scored);
    }
  }

  // Montant unique dans le mois + date large → auto
  const amountBuckets = new Map();
  for (const inv of invoices) {
    if (inv.amount_ttc == null) continue;
    const key = Number(inv.amount_ttc).toFixed(2);
    if (!amountBuckets.has(key)) amountBuckets.set(key, []);
    amountBuckets.get(key).push(inv);
  }

  for (const tx of transactions) {
    if (tx.matched_invoice_id) continue;
    const key = Number(tx.amount).toFixed(2);
    const bucket = amountBuckets.get(key) || [];
    if (bucket.length !== 1) continue;
    const inv = bucket[0];
    if (!datesWithinTolerance(tx.tx_date, inv.invoice_date, DAY_TOLERANCE_WIDE) && inv.invoice_date) {
      continue;
    }
    const labelScore = labelMatchScore(tx.label, inv, aliases);
    candidates.push({
      transactionId: tx.id,
      invoiceId: inv.id,
      score: labelScore >= 0.3 ? 0.82 : 0.72,
      labelScore,
      dayDiff: daysBetween(tx.tx_date, inv.invoice_date),
      uniqueAmount: true,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const matches = [];
  const usedInvoiceIds = new Set();
  const usedTxIds = new Set();

  for (const c of candidates) {
    if (usedTxIds.has(c.transactionId) || usedInvoiceIds.has(c.invoiceId)) continue;
    if (c.score < 0.68 && !c.uniqueAmount) continue;
    if (c.uniqueAmount && c.score < 0.7 && c.labelScore < 0.25) continue;

    let matchType = 'auto_fuzzy';
    let confidence = c.score;
    if (c.labelScore >= 0.7 && c.dayDiff <= DAY_TOLERANCE_STRICT) {
      matchType = 'auto_strict';
      confidence = Math.max(confidence, 0.92);
    } else if (c.uniqueAmount && c.labelScore < 0.45) {
      matchType = 'auto_amount';
      confidence = Math.min(confidence, 0.78);
    }

    matches.push({
      transactionId: c.transactionId,
      invoiceId: c.invoiceId,
      matchType,
      confidence: Math.round(confidence * 100) / 100,
    });
    usedTxIds.add(c.transactionId);
    usedInvoiceIds.add(c.invoiceId);
  }

  return matches;
}

export function listUnmatched(transactions, invoices) {
  const unmatchedTx = transactions.filter((t) => !t.matched_invoice_id);
  const matchedIds = new Set(
    transactions.filter((t) => t.matched_invoice_id).map((t) => t.matched_invoice_id)
  );
  const unmatchedInvoices = invoices.filter((i) => !matchedIds.has(i.id));
  return { unmatchedTx, unmatchedInvoices };
}
