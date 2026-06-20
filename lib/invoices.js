import { getSupabase } from './supabase.js';
import { runInvoiceOcr } from './ocr.js';
import { accountingMonthFromDate } from './locations.js';
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

export async function applyInvoiceOcr(invoiceId, buffer, mimeType, fileName) {
  try {
    const ocr = await runInvoiceOcr(buffer, mimeType, fileName);
    const accountingMonth = accountingMonthFromDate(ocr.invoiceDate || new Date());
    const sb = getSupabase();
    const { error } = await sb
      .from('invoices')
      .update({
        invoice_date: ocr.invoiceDate,
        amount_ttc: ocr.amountTtc,
        vendor_name: ocr.vendorName,
        accounting_month: accountingMonth,
        ocr_status: ocr.ocrStatus,
        ocr_raw: ocr.ocrRaw,
      })
      .eq('id', invoiceId);
    if (error) throw error;
    return ocr;
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

  const ocr = await runInvoiceOcr(buffer, mimeType, fileName);
  const accountingMonth = accountingMonthFromDate(ocr.invoiceDate || new Date());
  const storagePath = buildInvoicePath(locationSlug, accountingMonth, fileName);
  await uploadFile(BUCKET_INVOICES, storagePath, buffer, mimeType);

  return insertInvoiceRow(sb, {
    location_id: locationId,
    storage_path: storagePath,
    file_name: fileName,
    mime_type: mimeType,
    invoice_date: ocr.invoiceDate,
    amount_ttc: ocr.amountTtc,
    vendor_name: ocr.vendorName,
    accounting_month: accountingMonth,
    ocr_status: ocr.ocrStatus,
    ocr_raw: ocr.ocrRaw,
    source,
    source_phone: sourcePhone,
  });
}
