import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/api-auth';
import { apiError } from '../../../lib/apiJson';
import { getSupabase } from '../../../lib/supabase';
import { parseAccountingMonth } from '../../../lib/locations';
import {
  inferAccountingMonthFromTransactions,
  parseBankStatementFile,
} from '../../../lib/statement-parse';
import {
  BUCKET_STATEMENTS,
  buildStatementPath,
  getSignedDownloadUrl,
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
    const { data: location } = await sb.from('locations').select('id').eq('slug', locationSlug).maybeSingle();
    if (!location) return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });

    const { data: statement } = await sb
      .from('bank_statements')
      .select('*')
      .eq('location_id', location.id)
      .eq('accounting_month', month)
      .maybeSingle();

    let transactions = [];
    let downloadUrl = null;
    if (statement) {
      const { data: txs } = await sb
        .from('bank_transactions')
        .select('*, invoices:matched_invoice_id(id, file_name, vendor_name, amount_ttc)')
        .eq('statement_id', statement.id)
        .order('tx_date', { ascending: true });
      transactions = txs || [];
      if (searchParams.get('signed') === '1') {
        try {
          downloadUrl = await getSignedDownloadUrl(
            BUCKET_STATEMENTS,
            statement.storage_path,
            statement.file_name || `releve-${month}.pdf`
          );
        } catch {
          /* ignore */
        }
      }
    }

    return NextResponse.json({ statement, transactions, downloadUrl });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request) {
  try {
    await requireSession();
    const form = await request.formData();
    const locationSlug = String(form.get('location_slug') || '').trim();
    const formMonth = parseAccountingMonth(String(form.get('accounting_month') || '').trim());
    const file = form.get('file');

    if (!locationSlug || !formMonth || !file || typeof file === 'string') {
      return NextResponse.json({ error: 'location_slug, accounting_month et file requis' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: location } = await sb.from('locations').select('*').eq('slug', locationSlug).maybeSingle();
    if (!location) return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name || 'releve.pdf';
    const mimeType = file.type || 'application/pdf';

    const txs = await parseBankStatementFile(buffer, mimeType, fileName);
    const inferredMonth = inferAccountingMonthFromTransactions(txs);
    let accountingMonth = formMonth;
    let monthWarning = null;
    if (inferredMonth && inferredMonth !== formMonth) {
      accountingMonth = inferredMonth;
      monthWarning = `Le relevé correspond au mois ${inferredMonth} (pas ${formMonth}). Enregistré sous ${inferredMonth} — changez le filtre en haut pour le voir.`;
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
      statement,
      transactions: txs.length,
      accountingMonth,
      monthWarning,
    });
  } catch (err) {
    return apiError(err);
  }
}
