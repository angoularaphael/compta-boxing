import { getSupabase } from './supabase.js';
import {
  computeTvaAmounts,
  encodeTvaSnapshot,
  parseTauxTva,
} from './document-amounts.js';

const TABLE = 'documents';

const SOCIETES = {
  asso_tmbc: {
    nom: 'Association Toulouse Midi-Pyrénées Boxing Club',
    sigle: 'ASSO TMBC',
    adresse: '8 Rue Theron de Montauge, 31200 Toulouse',
    siren: '902 519 198',
    siret: '902 519 198 00011',
    tva: 'FR01902519198',
    email: 'contact@boxingcenter.fr',
    tel: '',
    logo: null,
  },
  boxing_center: {
    nom: 'SAS BOXING CENTER',
    sigle: 'BOXING CENTER',
    adresse: '12 rue de Fenouillet, 31200 Toulouse',
    siret: 'RCS Toulouse',
    tva: '',
    email: 'contact@boxingcenter.fr',
    tel: '',
    logo: 'logo.png',
  },
  distrix: {
    nom: 'DISTRIX SAS',
    sigle: 'DISTRIX',
    adresse: '15 Chemin de la Crabe, 31300 Toulouse',
    siret: '821 316 866 00028',
    siren: '821 316 866',
    tva: 'FR66821316866',
    email: 'contact@boxingcenter.fr',
    tel: '',
    logo: 'logo-distrix.png',
  },
};

export { SOCIETES };
export { parseTauxTva, computeTvaAmounts } from './document-amounts.js';

export async function getNextDocumentNumber(type) {
  const sb = getSupabase();
  const year = new Date().getFullYear();
  const prefix = type === 'devis' ? 'DEV' : 'FAC';
  const pattern = `${prefix}-${year}-%`;

  const { data } = await sb
    .from(TABLE)
    .select('numero')
    .like('numero', pattern)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle();

  let next = 1;
  if (data?.numero) {
    const parts = data.numero.split('-');
    const lastNum = parseInt(parts[2], 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }

  return `${prefix}-${year}-${String(next).padStart(3, '0')}`;
}

export async function createDocument(body) {
  const sb = getSupabase();
  const numero = await getNextDocumentNumber(body.type);

  const taux = parseTauxTva(body.taux_tva, 20);
  let amounts;
  if (body.montant_ht != null && body.montant_ht !== '') {
    amounts = computeTvaAmounts(body.montant_ht, taux);
  } else if (body.montant != null && body.montant !== '') {
    // Compat : montant fourni = TTC → déduire le HT
    const ttc = Number(body.montant);
    const ht = Math.round((ttc / (1 + taux / 100)) * 100) / 100;
    amounts = computeTvaAmounts(ht, taux);
    amounts.montant = Math.round(ttc * 100) / 100;
    amounts.montant_tva = Math.round((amounts.montant - amounts.montant_ht) * 100) / 100;
  } else {
    throw new Error('Montant HT requis');
  }

  const row = {
    type: body.type,
    numero,
    societe: body.societe,
    client_nom: body.client_nom?.trim(),
    client_email: body.client_email?.trim() || null,
    client_adresse: body.client_adresse?.trim() || null,
    client_telephone: body.client_telephone?.trim() || null,
    prestation: body.prestation?.trim(),
    montant_ht: amounts.montant_ht,
    taux_tva: amounts.taux_tva,
    montant_tva: amounts.montant_tva,
    montant: amounts.montant,
    date_document: body.date_document || new Date().toISOString().slice(0, 10),
    reference: body.reference?.trim() || null,
    conditions: encodeTvaSnapshot(body.conditions, amounts),
    created_by: body.created_by || null,
  };

  let { data, error } = await sb.from(TABLE).insert(row).select('*').single();

  // Si la migration TVA n'est pas encore appliquée → stocker au moins le TTC
  if (error && /montant_ht|taux_tva|montant_tva|schema cache/i.test(error.message || '')) {
    const legacy = { ...row };
    delete legacy.montant_ht;
    delete legacy.taux_tva;
    delete legacy.montant_tva;
    ({ data, error } = await sb.from(TABLE).insert(legacy).select('*').single());
  }

  if (error) throw new Error(error.message);
  return {
    ...data,
    montant_ht: amounts.montant_ht,
    taux_tva: amounts.taux_tva,
    montant_tva: amounts.montant_tva,
    montant: amounts.montant,
    conditions: row.conditions,
  };
}

export async function fetchDocuments({ type, search } = {}) {
  const sb = getSupabase();
  let query = sb.from(TABLE).select('*').order('created_at', { ascending: false });

  if (type) query = query.eq('type', type);
  if (search) {
    query = query.or(
      `client_nom.ilike.%${search}%,numero.ilike.%${search}%,prestation.ilike.%${search}%`
    );
  }

  const { data, error } = await query.limit(200);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchDocumentById(id) {
  const sb = getSupabase();
  const { data, error } = await sb.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
