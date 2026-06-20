export const LOCATION_SLUGS = ['minimes', 'etats_unis', 'st_cyprien', 'ramonville'];

export const LOCATION_LABELS = {
  minimes: 'Minimes',
  etats_unis: 'États-Unis',
  st_cyprien: 'Saint-Cyprien',
  ramonville: 'Ramonville',
};

export function accountingMonthFromDate(date) {
  if (!date) return currentAccountingMonth();
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return currentAccountingMonth();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function currentAccountingMonth() {
  const now = new Date();
  return accountingMonthFromDate(now);
}

export function parseAccountingMonth(value) {
  const v = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(v)) return null;
  return v;
}

export async function getLocationBySlug(sb, slug) {
  const { data, error } = await sb.from('locations').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listLocations(sb) {
  const { data, error } = await sb.from('locations').select('*').order('name');
  if (error) throw error;
  return data || [];
}
