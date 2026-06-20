import { NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/api-auth';
import { apiError } from '../../../../lib/apiJson';
import { getSupabase } from '../../../../lib/supabase';

export async function PATCH(request, { params }) {
  try {
    await requireSession();
    const { id } = params;
    const body = await request.json();

    const patch = {};
    if (body.invoice_date !== undefined) patch.invoice_date = body.invoice_date || null;
    if (body.amount_ttc !== undefined) patch.amount_ttc = body.amount_ttc;
    if (body.vendor_name !== undefined) patch.vendor_name = body.vendor_name;
    if (body.accounting_month !== undefined) patch.accounting_month = body.accounting_month;

    const sb = getSupabase();
    const { data, error } = await sb.from('invoices').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ invoice: data });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(request, { params }) {
  try {
    await requireSession();
    const sb = getSupabase();
    const { error } = await sb.from('invoices').delete().eq('id', params.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err);
  }
}
