import { getSupabase } from './supabase.js';

const TABLE = 'documents';

const SOCIETES = {
  asso_tmbc: {
    nom: 'Association Toulouse Midi-Pyrénées Boxing Club',
    sigle: 'ASSO TMBC',
    adresse: '12 rue de Fenouillet, 31200 Toulouse',
    siret: '',
    email: 'contact@boxingcenter.fr',
    tel: '',
  },
  boxing_center: {
    nom: 'SAS BOXING CENTER',
    sigle: 'BOXING CENTER',
    adresse: '12 rue de Fenouillet, 31200 Toulouse',
    siret: 'RCS Toulouse',
    email: 'contact@boxingcenter.fr',
    tel: '',
  },
  distrix: {
    nom: 'DISTRIX SAS',
    sigle: 'DISTRIX',
    adresse: '12 rue de Fenouillet, 31200 Toulouse',
    siret: '',
    email: 'contact@boxingcenter.fr',
    tel: '',
  },
};

export { SOCIETES };

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

  const row = {
    type: body.type,
    numero,
    societe: body.societe,
    client_nom: body.client_nom?.trim(),
    client_email: body.client_email?.trim() || null,
    client_adresse: body.client_adresse?.trim() || null,
    client_telephone: body.client_telephone?.trim() || null,
    prestation: body.prestation?.trim(),
    montant: Number(body.montant),
    date_document: body.date_document || new Date().toISOString().slice(0, 10),
    reference: body.reference?.trim() || null,
    conditions: body.conditions?.trim() || null,
    created_by: body.created_by || null,
  };

  const { data, error } = await sb.from(TABLE).insert(row).select('*').single();
  if (error) throw new Error(error.message);
  return data;
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
