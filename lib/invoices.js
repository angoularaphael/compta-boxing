import { getSupabase } from './supabase.js';
import { analyzeInvoice } from './invoice-analyze.js';
import { accountingMonthFromDate } from './locations.js';
import {
  extractInvoiceNumberFromFileName,
  extractInvoiceNumberFromText,
  normalizeInvoiceNumber,
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

    const invoiceNumber = resolveInvoiceNumberFromOcr(ocr, fileName);
    let duplicateOfId = null;
    let ocrStatus = ocr.ocrStatus;

    if (invoiceNumber) {
      const existing = await findDuplicateInvoice(sb, {
        locationId: current.location_id,
        accountingMonth: current.accounting_month,
        invoiceNumber,
        excludeId: invoiceId,
      });
      if (existing) {
        duplicateOfId = existing.id;
        ocrStatus = 'duplicate';
      }
    }

    const { data, error } = await sb
      .from('invoices')
      .update({
        invoice_date: ocr.invoiceDate,
        amount_ttc: ocr.amountTtc,
        vendor_name: ocr.vendorName,
        invoice_number: invoiceNumber,
        duplicate_of_id: duplicateOfId,
        ocr_status: ocrStatus,
        ocr_raw: ocr.ocrRaw,
      })
      .eq('id', invoiceId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
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
