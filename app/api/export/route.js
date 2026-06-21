import { NextResponse } from 'next/server';
import archiver from 'archiver';
import { requireSession } from '../../../lib/api-auth';
import { apiError } from '../../../lib/apiJson';
import { getSupabase } from '../../../lib/supabase';
import { parseAccountingMonth, LOCATION_LABELS } from '../../../lib/locations';
import { listUnmatched } from '../../../lib/match';
import { buildRecapPdf, mergeInvoicePdfs } from '../../../lib/export-pdf';
import {
  BUCKET_EXPORTS,
  BUCKET_INVOICES,
  BUCKET_STATEMENTS,
  buildExportPath,
  downloadFile,
  uploadFile,
} from '../../../lib/storage';

async function buildZipBuffer(files) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('data', (c) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    for (const f of files) archive.append(f.buffer, { name: f.name });
    archive.finalize();
  });
}

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
      sb
        .from('invoices')
        .select('*')
        .eq('location_id', location.id)
        .eq('accounting_month', month)
        .order('invoice_date', { ascending: true }),
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

    const billableInvoices = (invoices || []).filter(
      (inv) => inv.ocr_status === 'ok' || inv.ocr_status === 'partial'
    );

    const { unmatchedTx, unmatchedInvoices } = listUnmatched(transactions, billableInvoices);

    const invoiceBuffers = [];
    for (const inv of billableInvoices) {
      try {
        const buf = await downloadFile(BUCKET_INVOICES, inv.storage_path);
        invoiceBuffers.push(buf);
      } catch {
        // skip
      }
    }

    const mergedInvoices = await mergeInvoicePdfs(invoiceBuffers);
    const recap = await buildRecapPdf({
      locationName: LOCATION_LABELS[locationSlug] || location.name,
      accountingMonth: month,
      invoices: billableInvoices,
      unmatchedTx,
      unmatchedInvoices,
    });

    const zipFiles = [
      { name: `factures-${month}.pdf`, buffer: mergedInvoices },
      { name: `recap-${month}.pdf`, buffer: recap },
    ];

    if (statement) {
      try {
        const releve = await downloadFile(BUCKET_STATEMENTS, statement.storage_path);
        zipFiles.push({ name: statement.file_name || `releve-${month}.pdf`, buffer: releve });
      } catch {
        // skip
      }
    }

    const zipBuffer = await buildZipBuffer(zipFiles);
    const exportPath = buildExportPath(locationSlug, month);
    await uploadFile(BUCKET_EXPORTS, exportPath, zipBuffer, 'application/zip');

    await sb.from('monthly_closures').upsert(
      {
        location_id: location.id,
        accounting_month: month,
        export_path: exportPath,
      },
      { onConflict: 'location_id,accounting_month' }
    );

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="compta-${locationSlug}-${month}.zip"`,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
