import { NextResponse } from 'next/server';
import { fetchDocuments, createDocument } from '../../../lib/documents.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || '';
  const search = searchParams.get('search') || '';

  try {
    const documents = await fetchDocuments({ type, search });
    return NextResponse.json({ ok: true, documents, count: documents.length });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.type || !['devis', 'facture'].includes(body.type)) {
      return NextResponse.json({ ok: false, error: 'Type requis (devis ou facture)' }, { status: 400 });
    }
    if (!body.societe || !['asso_tmbc', 'boxing_center', 'distrix'].includes(body.societe)) {
      return NextResponse.json({ ok: false, error: 'Société requise' }, { status: 400 });
    }
    if (!body.client_nom?.trim()) {
      return NextResponse.json({ ok: false, error: 'Nom du client requis' }, { status: 400 });
    }
    if (!body.prestation?.trim()) {
      return NextResponse.json({ ok: false, error: 'Descriptif prestation requis' }, { status: 400 });
    }
    if (!body.montant || isNaN(Number(body.montant)) || Number(body.montant) <= 0) {
      return NextResponse.json({ ok: false, error: 'Montant invalide' }, { status: 400 });
    }

    const doc = await createDocument(body);
    return NextResponse.json({ ok: true, document: doc });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
