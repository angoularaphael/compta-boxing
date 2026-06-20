import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/api-auth';
import { apiError } from '../../../lib/apiJson';
import { getSupabase } from '../../../lib/supabase';
import { parseAccountingMonth } from '../../../lib/locations';
import { parseBankStatementFile } from '../../../lib/statement-parse';
import {
  BUCKET_STATEMENTS,
  buildStatementPath,
  uploadFile,
} from '../../../lib/storage';

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
    if (statement) {
      const { data: txs } = await sb
        .from('bank_transactions')
        .select('*, invoices:matched_invoice_id(id, file_name, vendor_name, amount_ttc)')
        .eq('statement_id', statement.id)
        .order('tx_date', { ascending: true });
      transactions = txs || [];
    }

    return NextResponse.json({ statement, transactions });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request) {
  try {
    await requireSession();
    const form = await request.formData();
    const locationSlug = String(form.get('location_slug') || '').trim();
    const month = parseAccountingMonth(String(form.get('accounting_month') || '').trim());
    const file = form.get('file');

    if (!locationSlug || !month || !file || typeof file === 'string') {
      return NextResponse.json({ error: 'location_slug, accounting_month et file requis' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: location } = await sb.from('locations').select('*').eq('slug', locationSlug).maybeSingle();
    if (!location) return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name || 'releve.pdf';
    const mimeType = file.type || 'application/pdf';
    const storagePath = buildStatementPath(locationSlug, month, fileName);
    await uploadFile(BUCKET_STATEMENTS, storagePath, buffer, mimeType);

    const { data: statement, error: stErr } = await sb
      .from('bank_statements')
      .upsert(
        {
          location_id: location.id,
          accounting_month: month,
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

    return NextResponse.json({ statement, transactions: txs.length });
  } catch (err) {
    return apiError(err);
  }
}
