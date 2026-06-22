import { NextResponse } from 'next/server';
import archiver from 'archiver';
import { requireSession } from '../../../lib/api-auth';
import { apiError } from '../../../lib/apiJson';
import { getSupabase } from '../../../lib/supabase';
import { parseAccountingMonth, LOCATION_LABELS } from '../../../lib/locations';
import { listUnmatched } from '../../../lib/match';
import { invoicesForMonthQuery } from '../../../lib/invoices';
import { buildRecapPdf } from '../../../lib/export-pdf';
import {
  BUCKET_EXPORTS,
  BUCKET_INVOICES,
  BUCKET_STATEMENTS,
  buildExportPath,
  downloadFile,
  uploadFile,
} from '../../../lib/storage';

function safeFilePart(raw, max = 40) {
  return String(raw || '')
    .replace(/[<>:"/\\|?*\n\r]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || 'fichier';
}

function invoiceExportName(inv) {
  const date = inv.invoice_date || 'sans-date';
  const vendor = safeFilePart(inv.vendor_name || 'fournisseur', 35);
  const amt = inv.amount_ttc != null ? `${Number(inv.amount_ttc).toFixed(2)}EUR` : '';
  const base = `${date} - ${vendor}${amt ? ` - ${amt}` : ''}`;
  const extMatch = String(inv.file_name || '').match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0] : '.pdf';
  return `${base}${ext}`;
}

function sortInvoicesForExport(invoices) {
  return [...invoices].sort((a, b) => {
    const da = a.invoice_date || a.created_at || '';
    const db = b.invoice_date || b.created_at || '';
    if (da !== db) return db.localeCompare(da);
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

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

    const billableInvoices = sortInvoicesForExport(
      (invoices || []).filter((inv) => inv.ocr_status === 'ok' || inv.ocr_status === 'partial')
    );

    const { unmatchedTx, unmatchedInvoices } = listUnmatched(transactions, billableInvoices);

    const zipFiles = [];

    if (statement) {
      try {
        const releve = await downloadFile(BUCKET_STATEMENTS, statement.storage_path);
        zipFiles.push({
          name: `releve-bancaire/${safeFilePart(statement.file_name || `releve-${month}.pdf`, 80)}`,
          buffer: releve,
        });
      } catch {
        /* skip */
      }
    }

    for (const inv of billableInvoices) {
      try {
        const buf = await downloadFile(BUCKET_INVOICES, inv.storage_path);
        zipFiles.push({
          name: `factures/${invoiceExportName(inv)}`,
          buffer: buf,
        });
      } catch {
        /* skip */
      }
    }

    const recap = await buildRecapPdf({
      locationName: LOCATION_LABELS[locationSlug] || location.name,
      accountingMonth: month,
      invoices: billableInvoices,
      unmatchedTx,
      unmatchedInvoices,
    });
    zipFiles.push({ name: `recap-${month}.pdf`, buffer: recap });

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
