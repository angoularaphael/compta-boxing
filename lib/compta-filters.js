import { LOCATION_SLUGS, currentAccountingMonth } from './locations';

export const COMPTA_FILTERS_STORAGE_KEY = 'compta-boxing-filters';

export const MONTH_OPTIONS = [
  { value: '01', label: 'Janvier' },
  { value: '02', label: 'Février' },
  { value: '03', label: 'Mars' },
  { value: '04', label: 'Avril' },
  { value: '05', label: 'Mai' },
  { value: '06', label: 'Juin' },
  { value: '07', label: 'Juillet' },
  { value: '08', label: 'Août' },
  { value: '09', label: 'Septembre' },
  { value: '10', label: 'Octobre' },
  { value: '11', label: 'Novembre' },
  { value: '12', label: 'Décembre' },
];

export function splitAccountingMonth(ym) {
  const [year = '', month = '01'] = String(ym || '').split('-');
  return { year, month };
}

export function buildAccountingMonth(year, month) {
  const y = String(year || '').trim();
  const m = String(month || '').trim().padStart(2, '0');
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m)) return null;
  const n = Number(m);
  if (n < 1 || n > 12) return null;
  return `${y}-${m}`;
}

export function readStoredComptaFilters() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(COMPTA_FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const location = String(parsed?.location || '').trim();
    const month = buildAccountingMonth(
      splitAccountingMonth(parsed?.month).year,
      splitAccountingMonth(parsed?.month).month
    );
    if (!LOCATION_SLUGS.includes(location) || !month) return null;
    return { location, month };
  } catch {
    return null;
  }
}

export function writeStoredComptaFilters(filters) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(COMPTA_FILTERS_STORAGE_KEY, JSON.stringify(filters));
}

export function defaultComptaFilters() {
  return {
    location: LOCATION_SLUGS[0],
    month: currentAccountingMonth(),
  };
}

export function monthLabel(ym) {
  const { year, month } = splitAccountingMonth(ym);
  const opt = MONTH_OPTIONS.find((m) => m.value === month);
  return opt ? `${opt.label} ${year}` : ym;
}
