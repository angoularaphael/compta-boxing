import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/api-auth';
import { apiError } from '../../../lib/apiJson';
import { getSupabase } from '../../../lib/supabase';
import { parseAccountingMonth } from '../../../lib/locations';
import { findAutoMatches } from '../../../lib/match';
import { invoicesForMonthQuery } from '../../../lib/invoices';

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
      .select('id')
      .eq('location_id', location.id)
      .eq('accounting_month', month)
      .maybeSingle();

    const [{ data: invoices }, { data: transactions }, { data: aliases }] = await Promise.all([
      invoicesForMonthQuery(sb, location.id, month).not(
        'ocr_status',
        'in',
        '("duplicate","failed","pending")'
      ),
      statement
        ? sb.from('bank_transactions').select('*').eq('statement_id', statement.id)
        : Promise.resolve({ data: [] }),
      sb.from('vendor_aliases').select('*').or(`location_id.is.null,location_id.eq.${location.id}`),
    ]);

    const txs = transactions || [];
    const invs = invoices || [];
    const matchedIds = new Set(txs.filter((t) => t.matched_invoice_id).map((t) => t.matched_invoice_id));
    const unmatchedTx = txs.filter((t) => !t.matched_invoice_id);
    const unmatchedInvoices = invs.filter((i) => !matchedIds.has(i.id));

    const sumAmounts = (rows) =>
      rows.reduce((sum, row) => sum + Math.abs(Number(row.amount ?? row.amount_ttc) || 0), 0);

    const totals = {
      statementLines: txs.length,
      totalExpenses: Math.round(sumAmounts(txs) * 100) / 100,
      unmatchedExpenses: Math.round(sumAmounts(unmatchedTx) * 100) / 100,
      matchedExpenses: Math.round(sumAmounts(txs.filter((t) => t.matched_invoice_id)) * 100) / 100,
      unmatchedInvoices: Math.round(sumAmounts(unmatchedInvoices) * 100) / 100,
    };

    return NextResponse.json({
      unmatchedTx,
      unmatchedInvoices,
      aliases: aliases || [],
      totals,
      hasStatement: Boolean(statement),
      statementMonth: month,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request) {
  try {
    await requireSession();
    const body = await request.json();
    const { transactionId, invoiceId, matchType = 'manual' } = body;
    if (!transactionId || !invoiceId) {
      return NextResponse.json({ error: 'transactionId et invoiceId requis' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: tx, error: txErr } = await sb
      .from('bank_transactions')
      .update({
        matched_invoice_id: invoiceId,
        match_type: matchType,
        match_confidence: matchType === 'manual' ? 1 : 0.8,
      })
      .eq('id', transactionId)
      .select('*')
      .single();
    if (txErr) throw txErr;

    return NextResponse.json({ transaction: tx });
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(request) {
  try {
    await requireSession();
    const body = await request.json();
    const { locationSlug, month } = body;
    const accountingMonth = parseAccountingMonth(month);
    if (!locationSlug || !accountingMonth) {
      return NextResponse.json({ error: 'locationSlug et month requis' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: location } = await sb.from('locations').select('id').eq('slug', locationSlug).maybeSingle();
    if (!location) return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });

    const { data: statement } = await sb
      .from('bank_statements')
      .select('id')
      .eq('location_id', location.id)
      .eq('accounting_month', accountingMonth)
      .maybeSingle();
    if (!statement) {
      return NextResponse.json({ error: 'Aucun relevé importé pour ce mois' }, { status: 400 });
    }

    const [{ data: invoices }, { data: transactions }, { data: aliases }] = await Promise.all([
      invoicesForMonthQuery(sb, location.id, accountingMonth).not(
        'ocr_status',
        'in',
        '("duplicate","failed","pending")'
      ),
      sb.from('bank_transactions').select('*').eq('statement_id', statement.id),
      sb.from('vendor_aliases').select('*').or(`location_id.is.null,location_id.eq.${location.id}`),
    ]);

    const matches = findAutoMatches(transactions || [], invoices || [], aliases || []);
    const applied = [];
    for (const m of matches) {
      const { error } = await sb
        .from('bank_transactions')
        .update({
          matched_invoice_id: m.invoiceId,
          match_type: m.matchType,
          match_confidence: m.confidence,
        })
        .eq('id', m.transactionId)
        .is('matched_invoice_id', null);
      if (!error) applied.push(m);
    }

    return NextResponse.json({ applied: applied.length, matches: applied });
  } catch (err) {
    return apiError(err);
  }
}
