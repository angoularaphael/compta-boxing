import { NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/api-auth';
import { apiError } from '../../../../lib/apiJson';
import { getSupabase } from '../../../../lib/supabase';
import { applyInvoiceOcr } from '../../../../lib/invoices';
import { BUCKET_INVOICES, downloadFile } from '../../../../lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request, { params }) {
  try {
    await requireSession();
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    const sb = getSupabase();
    const { data: inv, error } = await sb.from('invoices').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!inv) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

    await sb
      .from('invoices')
      .update({ ocr_status: 'pending', duplicate_of_id: null })
      .eq('id', id);

    const buffer = await downloadFile(BUCKET_INVOICES, inv.storage_path);
    const updated = await applyInvoiceOcr(id, buffer, inv.mime_type, inv.file_name);

    return NextResponse.json({ invoice: updated });
  } catch (err) {
    return apiError(err);
  }
}
