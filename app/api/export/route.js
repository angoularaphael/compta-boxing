import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/api-auth';
import { apiError } from '../../../lib/apiJson';
import { getSupabase } from '../../../lib/supabase';
import { parseAccountingMonth, LOCATION_LABELS } from '../../../lib/locations';
import { listUnmatched } from '../../../lib/match';
import { invoicesForMonthQuery } from '../../../lib/invoices';
import {
  buildRecapPdf,
  mergeInvoiceFiles,
  mergePdfBuffers,
  sortInvoicesChronologically,
} from '../../../lib/export-pdf';
import {
  BUCKET_EXPORTS,
  BUCKET_INVOICES,
  buildExportPath,
  downloadFile,
  uploadFile,
} from '../../../lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const locationSlug = searchParams.get('location');
    const month = parseAccountingMonth(searchParams.get('month'));
    if (!locationSlug || !month) {
      return NextResponse.json({ error: 'location et month requis' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: location } = await sb.from('locations').select('*').eq('slug', locationSlug).maybeSingle();
    if (!location) return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });

    const [{ data: invoices }, { data: statement }] = await Promise.all([
      invoicesForMonthQuery(sb, location.id, month).not(
        'ocr_status',
        'in',
        '("duplicate","failed","pending")'
      ),
      sb
        .from('bank_statements')
        .select('*')
        .eq('location_id', location.id)
        .eq('accounting_month', month)
        .maybeSingle(),
    ]);

    let transactions = [];
    if (statement) {
      const { data: txs } = await sb
        .from('bank_transactions')
        .select('*')
        .eq('statement_id', statement.id);
      transactions = txs || [];
    }

    const billableInvoices = sortInvoicesChronologically(
      (invoices || []).filter((inv) => inv.ocr_status === 'ok' || inv.ocr_status === 'partial')
    );

    const { unmatchedTx, unmatchedInvoices } = listUnmatched(transactions, billableInvoices);

    const invoiceFiles = [];
    for (const inv of billableInvoices) {
      try {
        const buffer = await downloadFile(BUCKET_INVOICES, inv.storage_path);
        invoiceFiles.push({ buffer, mimeType: inv.mime_type });
      } catch {
        /* skip missing file */
      }
    }

    const recap = await buildRecapPdf({
      locationName: LOCATION_LABELS[locationSlug] || location.name,
      accountingMonth: month,
      invoices: billableInvoices,
      unmatchedTx,
      unmatchedInvoices,
    });
    const invoicesPdf = await mergeInvoiceFiles(invoiceFiles);
    const mergedDoc = await mergePdfBuffers([recap, invoicesPdf]);
    const pdfBuffer = Buffer.from(await mergedDoc.save());

    const exportPath = buildExportPath(locationSlug, month);
    await uploadFile(BUCKET_EXPORTS, exportPath, pdfBuffer, 'application/pdf');

    await sb.from('monthly_closures').upsert(
      {
        location_id: location.id,
        accounting_month: month,
        export_path: exportPath,
      },
      { onConflict: 'location_id,accounting_month' }
    );

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="compta-${locationSlug}-${month}.pdf"`,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
