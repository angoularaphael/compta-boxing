import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/api-auth';
import { apiError } from '../../../lib/apiJson';
import { getSupabase } from '../../../lib/supabase';
import { parseAccountingMonth } from '../../../lib/locations';
import { invoicesForMonthQuery } from '../../../lib/invoices';
import {
  mergeInvoiceFiles,
  sortInvoicesChronologically,
} from '../../../lib/export-pdf';
import {
  createZipBuffer,
  invoiceDossierName,
  statementDossierName,
  uniqueZipName,
} from '../../../lib/export-dossier';
import {
  BUCKET_EXPORTS,
  BUCKET_INVOICES,
  BUCKET_STATEMENTS,
  buildExportPath,
  downloadFile,
  uploadFile,
} from '../../../lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function loadMonthFiles(sb, location, month) {
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

  const billableInvoices = sortInvoicesChronologically(
    (invoices || []).filter((inv) => inv.ocr_status === 'ok' || inv.ocr_status === 'partial')
  );

  const invoiceFiles = [];
  for (const inv of billableInvoices) {
    try {
      const buffer = await downloadFile(BUCKET_INVOICES, inv.storage_path);
      invoiceFiles.push({ invoice: inv, buffer, mimeType: inv.mime_type });
    } catch {
      /* skip missing file */
    }
  }

  let statementFile = null;
  if (statement?.storage_path) {
    try {
      const buffer = await downloadFile(BUCKET_STATEMENTS, statement.storage_path);
      statementFile = { statement, buffer };
    } catch {
      /* skip missing file */
    }
  }

  return { billableInvoices, invoiceFiles, statement, statementFile };
}

export async function GET(request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const locationSlug = searchParams.get('location');
    const month = parseAccountingMonth(searchParams.get('month'));
    const format = String(searchParams.get('format') || 'pdf').toLowerCase();
    if (!locationSlug || !month) {
      return NextResponse.json({ error: 'location et month requis' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: location } = await sb.from('locations').select('*').eq('slug', locationSlug).maybeSingle();
    if (!location) return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });

    const { invoiceFiles, statementFile } = await loadMonthFiles(sb, location, month);

    if (format === 'zip' || format === 'dossier') {
      if (!invoiceFiles.length && !statementFile) {
        return NextResponse.json(
          { error: 'Aucune facture ni relevé à empaqueter pour ce mois' },
          { status: 400 }
        );
      }

      const used = new Set();
      const zipFiles = [];
      const folder = `compta-${locationSlug}-${month}`;

      if (statementFile) {
        zipFiles.push({
          name: uniqueZipName(`${folder}/${statementDossierName(statementFile.statement, month)}`, used),
          buffer: statementFile.buffer,
        });
      }

      invoiceFiles.forEach((file, index) => {
        zipFiles.push({
          name: uniqueZipName(`${folder}/${invoiceDossierName(file.invoice, index)}`, used),
          buffer: file.buffer,
        });
      });

      const zipBuffer = await createZipBuffer(zipFiles);
      return new NextResponse(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="dossier-compta-${locationSlug}-${month}.zip"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const pdfBuffer = await mergeInvoiceFiles(
      invoiceFiles.map((file) => ({ buffer: file.buffer, mimeType: file.mimeType }))
    );

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
