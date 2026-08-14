/** Snapshot TVA dans `conditions` — survit si les colonnes HT/TVA n'existent pas encore. */
const TVA_SNAP_RE = /\[\[tva:([^|]+)\|ht:([^|]+)\|tva_amt:([^|]+)\|ttc:([^\]]+)\]\]/;

export function parseTauxTva(value, fallback = 20) {
  if (value === null || value === undefined || value === '') return fallback;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error('Taux de TVA invalide');
  }
  return rate;
}

export function computeTvaAmounts(montantHt, tauxTva) {
  const ht = Math.round(Number(montantHt) * 100) / 100;
  if (!Number.isFinite(ht) || ht <= 0) {
    throw new Error('Montant HT invalide');
  }
  const rate = parseTauxTva(tauxTva);
  const tva = Math.round(ht * rate) / 100;
  const ttc = Math.round((ht + tva) * 100) / 100;
  return {
    montant_ht: ht,
    taux_tva: rate,
    montant_tva: Math.round(tva * 100) / 100,
    montant: ttc,
  };
}

export function stripTvaSnapshot(text) {
  return String(text || '')
    .replace(TVA_SNAP_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function encodeTvaSnapshot(conditions, amounts) {
  const tag = `[[tva:${amounts.taux_tva}|ht:${amounts.montant_ht}|tva_amt:${amounts.montant_tva}|ttc:${amounts.montant}]]`;
  const rest = stripTvaSnapshot(conditions);
  return rest ? `${tag}\n${rest}` : tag;
}

export function decodeTvaSnapshot(text) {
  const m = String(text || '').match(TVA_SNAP_RE);
  if (!m) return null;
  return {
    taux_tva: Number(m[1]),
    montant_ht: Number(m[2]),
    montant_tva: Number(m[3]),
    montant: Number(m[4]),
  };
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 0 % est une valeur valide — ne jamais faire `taux || 20`.
 * Priorité : override (query) → colonnes DB → snapshot conditions → 20 %.
 */
export function resolveDocumentAmounts(doc, override = {}) {
  const snap = decodeTvaSnapshot(doc?.conditions);
  const taux =
    numOrNull(override.taux) ?? numOrNull(doc?.taux_tva) ?? numOrNull(snap?.taux_tva);
  let ht = numOrNull(override.ht) ?? numOrNull(doc?.montant_ht) ?? numOrNull(snap?.montant_ht);
  let tva = numOrNull(override.tva) ?? numOrNull(doc?.montant_tva) ?? numOrNull(snap?.montant_tva);
  let ttc = numOrNull(override.ttc) ?? numOrNull(doc?.montant) ?? numOrNull(snap?.montant);

  const rate = taux != null ? taux : 20;

  if (ht == null && ttc != null) {
    ht = Math.round((ttc / (1 + rate / 100)) * 100) / 100;
  }
  if (tva == null && ht != null && ttc != null) {
    tva = Math.round((ttc - ht) * 100) / 100;
  }
  if (ttc == null && ht != null) {
    tva = tva != null ? tva : Math.round(((ht * rate) / 100) * 100) / 100;
    ttc = Math.round((ht + tva) * 100) / 100;
  }

  return {
    ht: ht ?? 0,
    tva: tva ?? 0,
    ttc: ttc ?? 0,
    taux: rate,
  };
}
