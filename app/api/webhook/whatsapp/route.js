import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getSupabase } from '../../../../lib/supabase';
import { getLocationBySlug, parseAccountingMonth } from '../../../../lib/locations';
import { describeError } from '../../../../lib/apiJson';
import { ingestInvoiceFile, applyInvoiceOcr } from '../../../../lib/invoices';
import { notifyWhatsAppInvoiceReady } from '../../../../lib/bot-notify';
import { parseBankStatementFile } from '../../../../lib/statement-parse';
import {
  BUCKET_STATEMENTS,
  buildStatementPath,
  uploadFile,
} from '../../../../lib/storage';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function verifyLocationSecret(request, location) {
  const header = request.headers.get('x-webhook-secret') || '';
  const global = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  const local = location?.whatsapp_secret || '';
  if (local && header === local) return true;
  if (global && header === global) return true;
  return false;
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const locationSlug = String(form.get('location_slug') || '').trim();
    const docType = String(form.get('doc_type') || 'invoice').trim();
    const accountingMonthInput = String(form.get('accounting_month') || '').trim();
    const sourcePhone = String(form.get('from_phone') || '').trim() || null;
    const file = form.get('file');

    if (!locationSlug) {
      return NextResponse.json({ error: 'location_slug requis' }, { status: 400 });
    }
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'file requis' }, { status: 400 });
    }

    const sb = getSupabase();
    const location = await getLocationBySlug(sb, locationSlug);
    if (!location) {
      return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });
    }

    if (!(await verifyLocationSecret(request, location))) {
      return NextResponse.json({ error: 'Secret invalide' }, { status: 403 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name || 'document.bin';
    const mimeType = file.type || 'application/octet-stream';

    if (docType === 'statement') {
      const accountingMonth = parseAccountingMonth(accountingMonthInput);
      if (!accountingMonth) {
        return NextResponse.json({ error: 'accounting_month requis (YYYY-MM)' }, { status: 400 });
      }

      const storagePath = buildStatementPath(locationSlug, accountingMonth, fileName);
      await uploadFile(BUCKET_STATEMENTS, storagePath, buffer, mimeType);

      const { data: statement, error: stErr } = await sb
        .from('bank_statements')
        .upsert(
          {
            location_id: location.id,
            accounting_month: accountingMonth,
            storage_path: storagePath,
            file_name: fileName,
            mime_type: mimeType,
          },
          { onConflict: 'location_id,accounting_month' }
        )
        .select('*')
        .single();
      if (stErr) throw stErr;

      await sb.from('bank_transactions').delete().eq('statement_id', statement.id);

      const txs = await parseBankStatementFile(buffer, mimeType, fileName);
      if (txs.length) {
        const { error: txErr } = await sb.from('bank_transactions').insert(
          txs.map((t) => ({
            statement_id: statement.id,
            location_id: location.id,
            tx_date: t.txDate,
            label: t.label,
            amount: t.amount,
          }))
        );
        if (txErr) throw txErr;
      }

      return NextResponse.json({
        success: true,
        type: 'statement',
        statementId: statement.id,
        transactions: txs.length,
      });
    }

    const invoice = await ingestInvoiceFile({
      locationId: location.id,
      locationSlug,
      buffer,
      fileName,
      mimeType,
      source: 'whatsapp',
      sourcePhone,
      deferOcr: true,
    });

    waitUntil(
      (async () => {
        const updated = await applyInvoiceOcr(invoice.id, buffer, mimeType, fileName);
        await notifyWhatsAppInvoiceReady(location, updated);
      })()
    );

    return NextResponse.json({
      success: true,
      type: 'invoice',
      invoice,
      ocrPending: true,
    });
  } catch (err) {
    console.error('[webhook/whatsapp]', err);
    return NextResponse.json({ error: describeError(err) || 'Erreur serveur' }, { status: 500 });
  }
}
