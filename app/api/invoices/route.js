import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/api-auth';
import { apiError } from '../../../lib/apiJson';
import { getSupabase } from '../../../lib/supabase';
import { parseAccountingMonth } from '../../../lib/locations';
import { ingestInvoiceFile } from '../../../lib/invoices';

export async function GET(request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const locationSlug = searchParams.get('location');
    const month = parseAccountingMonth(searchParams.get('month'));
    if (!locationSlug || !month) {
      return NextResponse.json({ error: 'location et month requis (YYYY-MM)' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: location } = await sb.from('locations').select('id').eq('slug', locationSlug).maybeSingle();
    if (!location) return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });

    const { data, error } = await sb
      .from('invoices')
      .select('*')
      .eq('location_id', location.id)
      .eq('accounting_month', month)
      .order('invoice_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ invoices: data || [] });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request) {
  try {
    await requireSession();
    const form = await request.formData();
    const locationSlug = String(form.get('location_slug') || '').trim();
    const file = form.get('file');
    if (!locationSlug || !file || typeof file === 'string') {
      return NextResponse.json({ error: 'location_slug et file requis' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: location } = await sb.from('locations').select('*').eq('slug', locationSlug).maybeSingle();
    if (!location) return NextResponse.json({ error: 'Salle inconnue' }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const invoice = await ingestInvoiceFile({
      locationId: location.id,
      locationSlug,
      buffer,
      fileName: file.name || 'facture.pdf',
      mimeType: file.type || 'application/pdf',
      source: 'upload',
    });

    return NextResponse.json({ invoice });
  } catch (err) {
    return apiError(err);
  }
}
