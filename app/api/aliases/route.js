import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/api-auth';
import { apiError } from '../../../lib/apiJson';
import { getSupabase } from '../../../lib/supabase';

export async function POST(request) {
  try {
    await requireSession();
    const body = await request.json();
    const { locationId, bankLabel, vendorName } = body;
    if (!bankLabel || !vendorName) {
      return NextResponse.json({ error: 'bankLabel et vendorName requis' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data, error } = await sb
      .from('vendor_aliases')
      .insert({
        location_id: locationId || null,
        bank_label: bankLabel,
        vendor_name: vendorName,
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ alias: data });
  } catch (err) {
    return apiError(err);
  }
}
