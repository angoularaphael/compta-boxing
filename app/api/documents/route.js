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
    const hasHt = body.montant_ht != null && body.montant_ht !== '';
    const hasTtc = body.montant != null && body.montant !== '';
    if (!hasHt && !hasTtc) {
      return NextResponse.json({ ok: false, error: 'Montant HT requis' }, { status: 400 });
    }
    if (hasHt && (isNaN(Number(body.montant_ht)) || Number(body.montant_ht) <= 0)) {
      return NextResponse.json({ ok: false, error: 'Montant HT invalide' }, { status: 400 });
    }
    if (body.taux_tva != null && body.taux_tva !== '') {
      const taux = Number(body.taux_tva);
      if (isNaN(taux) || taux < 0 || taux > 100) {
        return NextResponse.json({ ok: false, error: 'Taux de TVA invalide' }, { status: 400 });
      }
    }

    const doc = await createDocument(body);
    return NextResponse.json({ ok: true, document: doc });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
