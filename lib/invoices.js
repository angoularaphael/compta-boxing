import { getSupabase } from './supabase.js';
import { runInvoiceOcr } from './ocr.js';
import { accountingMonthFromDate } from './locations.js';
import {
  BUCKET_INVOICES,
  buildInvoicePath,
  uploadFile,
} from './storage.js';

export async function ingestInvoiceFile({
  locationId,
  locationSlug,
  buffer,
  fileName,
  mimeType,
  source = 'whatsapp',
  sourcePhone = null,
}) {
  const ocr = await runInvoiceOcr(buffer, mimeType, fileName);
  const accountingMonth = accountingMonthFromDate(ocr.invoiceDate || new Date());

  const storagePath = buildInvoicePath(locationSlug, accountingMonth, fileName);
  await uploadFile(BUCKET_INVOICES, storagePath, buffer, mimeType);

  const sb = getSupabase();
  const { data, error } = await sb
    .from('invoices')
    .insert({
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
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}
