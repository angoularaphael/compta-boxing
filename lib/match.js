import Fuse from 'fuse.js';

const DAY_TOLERANCE = 3;

export function amountsMatch(a, b, tolerance = 0.01) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

export function datesWithinTolerance(dateA, dateB, days = DAY_TOLERANCE) {
  if (!dateA || !dateB) return false;
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  const diff = Math.abs(a.getTime() - b.getTime());
  return diff <= days * 24 * 60 * 60 * 1000;
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function resolveVendorName(invoice, aliases) {
  const vendor = normalize(invoice.vendor_name);
  for (const alias of aliases) {
    if (normalize(alias.vendor_name) === vendor) return alias.vendor_name;
  }
  return invoice.vendor_name || '';
}

function labelMatchesInvoice(label, invoice, aliases) {
  const normLabel = normalize(label);
  const vendor = normalize(resolveVendorName(invoice, aliases));
  if (!vendor || vendor.length < 2) return false;

  if (normLabel.includes(vendor) || vendor.includes(normLabel)) return true;

  for (const alias of aliases) {
    const bank = normalize(alias.bank_label);
    const vend = normalize(alias.vendor_name);
    if (bank && normLabel.includes(bank) && vend === vendor) return true;
    if (bank && normLabel.includes(bank) && normalize(invoice.vendor_name) === vend) return true;
  }

  const fuse = new Fuse([{ name: vendor }], { keys: ['name'], threshold: 0.45 });
  const hit = fuse.search(normLabel);
  return hit.length > 0;
}

export function findAutoMatches(transactions, invoices, aliases = []) {
  const matches = [];
  const usedInvoiceIds = new Set();
  const usedTxIds = new Set();

  for (const tx of transactions) {
    if (tx.matched_invoice_id) continue;

    for (const inv of invoices) {
      if (usedInvoiceIds.has(inv.id)) continue;
      if (!amountsMatch(tx.amount, inv.amount_ttc)) continue;
      if (!datesWithinTolerance(tx.tx_date, inv.invoice_date)) continue;

      matches.push({
        transactionId: tx.id,
        invoiceId: inv.id,
        matchType: 'auto_strict',
        confidence: 0.95,
      });
      usedInvoiceIds.add(inv.id);
      usedTxIds.add(tx.id);
      break;
    }
  }

  for (const tx of transactions) {
    if (usedTxIds.has(tx.id) || tx.matched_invoice_id) continue;

    const candidates = invoices.filter(
      (inv) =>
        !usedInvoiceIds.has(inv.id) &&
        amountsMatch(tx.amount, inv.amount_ttc) &&
        labelMatchesInvoice(tx.label, inv, aliases)
    );

    if (candidates.length === 1) {
      matches.push({
        transactionId: tx.id,
        invoiceId: candidates[0].id,
        matchType: 'auto_fuzzy',
        confidence: 0.75,
      });
      usedInvoiceIds.add(candidates[0].id);
      usedTxIds.add(tx.id);
    }
  }

  return matches;
}

export function listUnmatched(transactions, invoices) {
  const unmatchedTx = transactions.filter((t) => !t.matched_invoice_id);
  const matchedIds = new Set(transactions.filter((t) => t.matched_invoice_id).map((t) => t.matched_invoice_id));
  const unmatchedInvoices = invoices.filter((i) => !matchedIds.has(i.id));
  return { unmatchedTx, unmatchedInvoices };
}
