import { getSupabase } from './supabase.js';
import { analyzeInvoice } from './invoice-analyze.js';
import { accountingMonthFromDate, parseAccountingMonth } from './locations.js';

/** Mois comptable déduit de la date facture (YYYY-MM-DD). */
export function accountingMonthFromInvoiceDate(invoiceDate) {
  if (!invoiceDate) return null;
  const iso = String(invoiceDate).trim().slice(0, 10);
  const m = iso.match(/^(\d{4}-\d{2})-\d{2}$/);
  return m ? parseAccountingMonth(m[1]) : accountingMonthFromDate(new Date(invoiceDate));
}

function monthEndExclusive(month) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return null;
  const next = m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
  return `${next.year}-${String(next.month).padStart(2, '0')}-01`;
}

/** Factures visibles pour un mois : mois comptable OU date facture dans ce mois. */
export function invoicesForMonthQuery(sb, locationId, month) {
  const start = `${month}-01`;
  const end = monthEndExclusive(month);
  const dateRange = end
    ? `and(invoice_date.gte.${start},invoice_date.lt.${end})`
    : `invoice_date.gte.${start}`;
  return sb
    .from('invoices')
    .select('*')
    .eq('location_id', locationId)
    .or(`accounting_month.eq.${month},${dateRange}`);
}
import {
  extractInvoiceNumberFromFileName,
  extractInvoiceNumberFromText,
  normalizeInvoiceNumber,
  normalizeVendorName,
} from './invoice-number.js';
import {
  BUCKET_INVOICES,
  buildInvoicePath,
  uploadFile,
} from './storage.js';

async function insertInvoiceRow(sb, fields) {
  const { data, error } = await sb.from('invoices').insert(fields).select('*').single();
  if (error) throw error;
  return data;
}

async function findDuplicateByFileName(sb, { locationId, accountingMonth, fileName, excludeId }) {
  if (!fileName) return null;
  const { data, error } = await sb
    .from('invoices')
    .select('id, file_name, vendor_name, invoice_date, amount_ttc, invoice_number')
    .eq('location_id', locationId)
    .eq('accounting_month', accountingMonth)
    .eq('file_name', fileName)
    .neq('id', excludeId)
    .not('ocr_status', 'in', '("duplicate","failed")')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findDuplicateInvoice(sb, { locationId, accountingMonth, invoiceNumber, excludeId }) {
  const norm = normalizeInvoiceNumber(invoiceNumber);
  if (!norm) return null;

  const { data, error } = await sb
    .from('invoices')
    .select('id, file_name, vendor_name, invoice_date, amount_ttc, invoice_number')
    .eq('location_id', locationId)
    .eq('accounting_month', accountingMonth)
    .eq('invoice_number', norm)
    .neq('id', excludeId)
    .not('ocr_status', 'in', '("duplicate","failed")')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findDuplicateByFingerprint(
  sb,
  { locationId, accountingMonth, vendorName, invoiceDate, amountTtc, excludeId }
) {
  if (!invoiceDate || amountTtc == null) return null;
  const vendor = normalizeVendorName(vendorName);
  if (!vendor || vendor.length < 3) return null;

  const { data, error } = await sb
    .from('invoices')
    .select('id, file_name, vendor_name, invoice_date, amount_ttc, invoice_number')
    .eq('location_id', locationId)
    .eq('accounting_month', accountingMonth)
    .eq('invoice_date', invoiceDate)
    .eq('amount_ttc', amountTtc)
    .neq('id', excludeId)
    .not('ocr_status', 'in', '("duplicate","failed")')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (
    (data || []).find((row) => {
      const rowVendor = normalizeVendorName(row.vendor_name);
      if (!rowVendor) return false;
      return rowVendor === vendor || rowVendor.includes(vendor) || vendor.includes(rowVendor);
    }) || null
  );
}

async function resolveDuplicate(sb, ctx, ocr, invoiceNumber, excludeId, fileName) {
  const byFile = await findDuplicateByFileName(sb, {
    locationId: ctx.location_id,
    accountingMonth: ctx.accounting_month,
    fileName,
    excludeId,
  });
  if (byFile) return { existing: byFile, reason: 'filename' };

  if (invoiceNumber) {
    const byNumber = await findDuplicateInvoice(sb, {
      locationId: ctx.location_id,
      accountingMonth: ctx.accounting_month,
      invoiceNumber,
      excludeId,
    });
    if (byNumber) return { existing: byNumber, reason: 'number' };
  }

  const byFingerprint = await findDuplicateByFingerprint(sb, {
    locationId: ctx.location_id,
    accountingMonth: ctx.accounting_month,
    vendorName: ocr.vendorName,
    invoiceDate: ocr.invoiceDate,
    amountTtc: ocr.amountTtc,
    excludeId,
  });
  if (byFingerprint) return { existing: byFingerprint, reason: 'fingerprint' };

  return null;
}

function fingerprintKey(row) {
  if (!row.invoice_date || row.amount_ttc == null) return null;
  const vendor = normalizeVendorName(row.vendor_name);
  if (!vendor || vendor.length < 3) return null;
  return `${row.invoice_date}|${Number(row.amount_ttc)}|${vendor}`;
}

/** Corrige les doublons (course OCR parallèle) — garde la plus ancienne facture. */
export async function reconcileDuplicatesInMonth(sb, locationId, accountingMonth) {
  const { data: rows, error } = await sb
    .from('invoices')
    .select(
      'id, created_at, file_name, invoice_number, vendor_name, invoice_date, amount_ttc, ocr_status'
    )
    .eq('location_id', locationId)
    .eq('accounting_month', accountingMonth)
    .in('ocr_status', ['ok', 'partial', 'duplicate'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!rows?.length) return 0;

  const seenFiles = new Map();
  const seenNumbers = new Map();
  const seenFingerprints = new Map();
  let marked = 0;

  for (const row of rows) {
    if (row.ocr_status === 'duplicate') continue;

    let duplicateOf = null;
    if (row.file_name && seenFiles.has(row.file_name)) {
      duplicateOf = seenFiles.get(row.file_name);
    }
    const num = normalizeInvoiceNumber(row.invoice_number);
    if (!duplicateOf && num && seenNumbers.has(num)) {
      duplicateOf = seenNumbers.get(num);
    }
    const fp = fingerprintKey(row);
    if (!duplicateOf && fp && seenFingerprints.has(fp)) {
      duplicateOf = seenFingerprints.get(fp);
    }

    if (duplicateOf) {
      const { error: updErr } = await sb
        .from('invoices')
        .update({ ocr_status: 'duplicate', duplicate_of_id: duplicateOf })
        .eq('id', row.id);
      if (!updErr) marked += 1;
      continue;
    }

    if (row.file_name) seenFiles.set(row.file_name, row.id);
    if (num) seenNumbers.set(num, row.id);
    if (fp) seenFingerprints.set(fp, row.id);
  }

  return marked;
}

function resolveInvoiceNumberFromOcr(ocr, fileName) {
  return (
    normalizeInvoiceNumber(ocr.invoiceNumber) ||
    extractInvoiceNumberFromText(ocr.ocrRaw) ||
    extractInvoiceNumberFromFileName(fileName)
  );
}

export async function applyInvoiceOcr(invoiceId, buffer, mimeType, fileName) {
  try {
    const ocr = await analyzeInvoice(buffer, mimeType, fileName);
    const sb = getSupabase();

    const { data: current, error: currentErr } = await sb
      .from('invoices')
      .select('id, location_id, accounting_month')
      .eq('id', invoiceId)
      .single();
    if (currentErr) throw currentErr;

    const accountingMonth =
      accountingMonthFromInvoiceDate(ocr.invoiceDate) || current.accounting_month;
    const ctx = { ...current, accounting_month: accountingMonth };

    const invoiceNumber = resolveInvoiceNumberFromOcr(ocr, fileName);
    let duplicateOfId = null;
    let ocrStatus = ocr.ocrStatus;

    const duplicate = await resolveDuplicate(sb, ctx, ocr, invoiceNumber, invoiceId, fileName);
    if (duplicate) {
      duplicateOfId = duplicate.existing.id;
      ocrStatus = 'duplicate';
    }

    const { data, error } = await sb
      .from('invoices')
      .update({
        invoice_date: ocr.invoiceDate,
        amount_ttc: ocr.amountTtc,
        vendor_name: ocr.vendorName,
        invoice_number: invoiceNumber,
        accounting_month: accountingMonth,
        duplicate_of_id: duplicateOfId,
        ocr_status: ocrStatus,
        ocr_raw: ocr.ocrRaw,
      })
      .eq('id', invoiceId)
      .select('*')
      .single();
    if (error) throw error;

    await reconcileDuplicatesInMonth(sb, current.location_id, accountingMonth);
    if (accountingMonth !== current.accounting_month) {
      await reconcileDuplicatesInMonth(sb, current.location_id, current.accounting_month);
    }

    const { data: finalRow } = await sb.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
    return finalRow || data;
  } catch (err) {
    console.error('[applyInvoiceOcr]', invoiceId, err);
    try {
      const sb = getSupabase();
      await sb.from('invoices').update({ ocr_status: 'failed' }).eq('id', invoiceId);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function ingestInvoiceFile({
  locationId,
  locationSlug,
  buffer,
  fileName,
  mimeType,
  source = 'whatsapp',
  sourcePhone = null,
  deferOcr = false,
}) {
  const sb = getSupabase();

  if (deferOcr) {
    const accountingMonth = accountingMonthFromDate(new Date());
    const storagePath = buildInvoicePath(locationSlug, accountingMonth, fileName);
    await uploadFile(BUCKET_INVOICES, storagePath, buffer, mimeType);

    return insertInvoiceRow(sb, {
      location_id: locationId,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      invoice_date: null,
      amount_ttc: null,
      vendor_name: null,
      accounting_month: accountingMonth,
      ocr_status: 'pending',
      ocr_raw: null,
      source,
      source_phone: sourcePhone,
    });
  }

  const ocr = await analyzeInvoice(buffer, mimeType, fileName);
  const accountingMonth = accountingMonthFromDate(new Date());
  const storagePath = buildInvoicePath(locationSlug, accountingMonth, fileName);
  await uploadFile(BUCKET_INVOICES, storagePath, buffer, mimeType);

  const invoiceNumber = resolveInvoiceNumberFromOcr(ocr, fileName);

  return insertInvoiceRow(sb, {
    location_id: locationId,
    storage_path: storagePath,
    file_name: fileName,
    mime_type: mimeType,
    invoice_date: ocr.invoiceDate,
    amount_ttc: ocr.amountTtc,
    vendor_name: ocr.vendorName,
    invoice_number: invoiceNumber,
    accounting_month: accountingMonth,
    ocr_status: ocr.ocrStatus,
    ocr_raw: ocr.ocrRaw,
    source,
    source_phone: sourcePhone,
  });
}
