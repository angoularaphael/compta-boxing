import Fuse from 'fuse.js';

const DAY_TOLERANCE_STRICT = 7;
const DAY_TOLERANCE_WIDE = 45;
/** Si le libellé est très proche du fournisseur, on accepte un écart de date plus large (factures antérieures payées ce mois). */
const DAY_TOLERANCE_STRONG_LABEL = 400;

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
  'ei',
  'eirl',
  'auto',
  'entrepreneur',
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

/** Enlève suffixes juridiques pour comparer les noms. */
function stripLegalSuffix(str) {
  return normalize(str)
    .replace(/\b(ei|eirl|sas|sarl|eurl|sa|sci|auto entrepreneur)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(str) {
  return stripLegalSuffix(str)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

function tokenSimilar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  // VIDOT / VIDOTTO, LALOGE / LALOGE…
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 4 && longer.startsWith(shorter)) return true;
  if (shorter.length >= 5 && levenshtein(a, b) <= 2) return true;
  return false;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], row[j], prev) + 1;
      row[j - 1] = prev;
      prev = cur;
    }
    row[b.length] = prev;
  }
  return row[b.length];
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
    if (labelTokens.some((lt) => tokenSimilar(lt, vt))) hits += 1;
  }
  return hits / vendorTokens.length;
}

function labelMatchScore(label, invoice, aliases) {
  const normLabel = stripLegalSuffix(label);
  const labelTokens = significantTokens(label);
  const vendorRaw = resolveVendorName(invoice, aliases);
  const vendor = stripLegalSuffix(vendorRaw);
  const vendorTokens = significantTokens(vendorRaw);
  let score = 0;

  if (vendor && vendor.length >= 2) {
    if (normLabel.includes(vendor) || vendor.includes(normLabel)) score = Math.max(score, 0.95);
    const overlap = tokenOverlapScore(labelTokens, vendorTokens);
    score = Math.max(score, overlap);
    // Prénom + nom partiel (sebastien + vidot≈vidotto)
    if (vendorTokens.length >= 2 && overlap >= 0.5) {
      const lastHit = vendorTokens.some((vt) =>
        labelTokens.some((lt) => tokenSimilar(lt, vt) && lt.length >= 4)
      );
      const firstHit = vendorTokens.some((vt) => labelTokens.some((lt) => lt === vt));
      if (firstHit && lastHit) score = Math.max(score, 0.88);
    }
  }

  for (const alias of aliases) {
    const bank = normalize(alias.bank_label);
    const vend = stripLegalSuffix(alias.vendor_name);
    const invVend = stripLegalSuffix(invoice.vendor_name);
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

  if (vendor && vendor.length >= 3 && score < 0.5) {
    const fuse = new Fuse([{ name: vendor }], {
      keys: ['name'],
      threshold: 0.45,
      includeScore: true,
    });
    const hit = fuse.search(normLabel);
    if (hit.length) {
      const fuseScore = 1 - (hit[0].score || 1);
      score = Math.max(score, fuseScore * 0.9);
    }
  }

  return score;
}

function scorePair(tx, inv, aliases) {
  if (!amountsMatch(tx.amount, inv.amount_ttc)) return null;

  const dayDiff = daysBetween(tx.tx_date, inv.invoice_date);
  const labelScore = labelMatchScore(tx.label, inv, aliases);

  // Libellé fort (ex. Sebastien VIDOT ≈ Sébastien VIDOTTO) → date presque optionnelle
  const maxDays =
    labelScore >= 0.75
      ? DAY_TOLERANCE_STRONG_LABEL
      : labelScore >= 0.55
        ? DAY_TOLERANCE_WIDE
        : DAY_TOLERANCE_STRICT;

  if (inv.invoice_date && dayDiff > maxDays) return null;

  let score = 0.4; // montant égal
  if (!inv.invoice_date || !Number.isFinite(dayDiff)) {
    score += 0.05;
  } else if (dayDiff <= DAY_TOLERANCE_STRICT) {
    score += 0.3 * (1 - dayDiff / (DAY_TOLERANCE_STRICT + 1));
  } else if (dayDiff <= DAY_TOLERANCE_WIDE) {
    score += 0.12;
  } else if (labelScore >= 0.75) {
    score += 0.08; // paiement d'une facture plus ancienne, mais nom clair
  }

  score += 0.35 * Math.min(1, labelScore);
  if (labelScore >= 0.8) score += 0.12;
  else if (labelScore >= 0.65) score += 0.06;

  return {
    transactionId: tx.id,
    invoiceId: inv.id,
    score: Math.min(0.99, score),
    labelScore,
    dayDiff,
  };
}

/**
 * Cas évident : même montant + même fournisseur (fuzzy), N lignes ↔ N factures.
 * Ex. 3× 780€ VIDOT ↔ 3× 780€ VIDOTTO.
 */
function findSameVendorAmountMatches(transactions, invoices, aliases, usedTxIds, usedInvoiceIds) {
  const out = [];
  const unmatchedTx = transactions.filter((t) => !t.matched_invoice_id && !usedTxIds.has(t.id));
  const unmatchedInv = invoices.filter((i) => !usedInvoiceIds.has(i.id));

  // Grouper les factures par montant
  const invByAmount = new Map();
  for (const inv of unmatchedInv) {
    if (inv.amount_ttc == null) continue;
    const key = Number(inv.amount_ttc).toFixed(2);
    if (!invByAmount.has(key)) invByAmount.set(key, []);
    invByAmount.get(key).push(inv);
  }

  for (const tx of unmatchedTx) {
    if (usedTxIds.has(tx.id)) continue;
    const key = Number(tx.amount).toFixed(2);
    const bucket = (invByAmount.get(key) || []).filter((inv) => !usedInvoiceIds.has(inv.id));
    if (!bucket.length) continue;

    const ranked = bucket
      .map((inv) => ({
        inv,
        labelScore: labelMatchScore(tx.label, inv, aliases),
        dayDiff: daysBetween(tx.tx_date, inv.invoice_date),
      }))
      .filter((r) => r.labelScore >= 0.7)
      .sort((a, b) => b.labelScore - a.labelScore || a.dayDiff - b.dayDiff);

    if (!ranked.length) continue;
    const best = ranked[0];
    usedTxIds.add(tx.id);
    usedInvoiceIds.add(best.inv.id);
    out.push({
      transactionId: tx.id,
      invoiceId: best.inv.id,
      matchType: 'auto_vendor_amount',
      confidence: Math.min(0.95, 0.7 + best.labelScore * 0.25),
      labelScore: best.labelScore,
      dayDiff: best.dayDiff,
    });
  }

  return out;
}

export function findAutoMatches(transactions, invoices, aliases = []) {
  const usedInvoiceIds = new Set();
  const usedTxIds = new Set();
  const matches = [];

  // 1) Paires montant + libellé fort (y compris dates éloignées)
  const candidates = [];
  for (const tx of transactions) {
    if (tx.matched_invoice_id) continue;
    for (const inv of invoices) {
      const scored = scorePair(tx, inv, aliases);
      if (!scored) continue;
      if (scored.labelScore >= 0.7 && scored.score >= 0.6) {
        candidates.push(scored);
        continue;
      }
      if (scored.score >= 0.72 && scored.dayDiff <= DAY_TOLERANCE_WIDE) {
        candidates.push(scored);
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.dayDiff - b.dayDiff);

  for (const c of candidates) {
    if (usedTxIds.has(c.transactionId) || usedInvoiceIds.has(c.invoiceId)) continue;
    let matchType = 'auto_fuzzy';
    let confidence = c.score;
    if (c.labelScore >= 0.75) {
      matchType = c.dayDiff <= DAY_TOLERANCE_STRICT ? 'auto_strict' : 'auto_vendor_amount';
      confidence = Math.max(confidence, 0.88);
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

  // 2) Même montant + même fournisseur (multi-lignes identiques)
  for (const m of findSameVendorAmountMatches(
    transactions,
    invoices,
    aliases,
    usedTxIds,
    usedInvoiceIds
  )) {
    matches.push({
      transactionId: m.transactionId,
      invoiceId: m.invoiceId,
      matchType: m.matchType,
      confidence: Math.round(m.confidence * 100) / 100,
    });
  }

  // 3) Montant unique dans le mois + date large
  const amountBuckets = new Map();
  for (const inv of invoices) {
    if (inv.amount_ttc == null || usedInvoiceIds.has(inv.id)) continue;
    const key = Number(inv.amount_ttc).toFixed(2);
    if (!amountBuckets.has(key)) amountBuckets.set(key, []);
    amountBuckets.get(key).push(inv);
  }

  for (const tx of transactions) {
    if (tx.matched_invoice_id || usedTxIds.has(tx.id)) continue;
    const key = Number(tx.amount).toFixed(2);
    const bucket = (amountBuckets.get(key) || []).filter((inv) => !usedInvoiceIds.has(inv.id));
    if (bucket.length !== 1) continue;
    const inv = bucket[0];
    if (inv.invoice_date && !datesWithinTolerance(tx.tx_date, inv.invoice_date, DAY_TOLERANCE_WIDE)) {
      continue;
    }
    const labelScore = labelMatchScore(tx.label, inv, aliases);
    matches.push({
      transactionId: tx.id,
      invoiceId: inv.id,
      matchType: 'auto_amount',
      confidence: labelScore >= 0.3 ? 0.8 : 0.72,
    });
    usedTxIds.add(tx.id);
    usedInvoiceIds.add(inv.id);
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
