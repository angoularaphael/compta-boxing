import { NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/api-auth';
import { apiError } from '../../../../lib/apiJson';
import { getSupabase } from '../../../../lib/supabase';
import { BUCKET_INVOICES, downloadFile, getSignedDownloadUrl } from '../../../../lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request, { params }) {
  try {
    await requireSession();
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    const sb = getSupabase();
    const { data: inv, error } = await sb.from('invoices').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!inv) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

    const fileName = String(inv.file_name || 'facture.pdf');
    const { searchParams } = new URL(request.url);
    const wantsJson = searchParams.get('signed') === '1';

    try {
      const signedUrl = await getSignedDownloadUrl(BUCKET_INVOICES, inv.storage_path, fileName, 300);
      if (wantsJson) {
        return NextResponse.json({ url: signedUrl, fileName });
      }
      return NextResponse.redirect(signedUrl, 302);
    } catch (signedErr) {
      console.warn('[invoice download] signed url failed, fallback proxy', signedErr);
      const buffer = await downloadFile(BUCKET_INVOICES, inv.storage_path);
      const asciiName =
        fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\r\n]/g, '_') || 'facture.pdf';
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': inv.mime_type || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
  } catch (err) {
    return apiError(err);
  }
}

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
    const { data: inv, error: fetchErr } = await sb
      .from('invoices')
      .select('id, storage_path')
      .eq('id', params.id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!inv) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

    const { error } = await sb.from('invoices').delete().eq('id', params.id);
    if (error) throw error;

    if (inv.storage_path) {
      const { error: storageErr } = await sb.storage.from(BUCKET_INVOICES).remove([inv.storage_path]);
      if (storageErr) console.warn('[invoice delete] storage remove', inv.storage_path, storageErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return apiError(err);
  }
}
