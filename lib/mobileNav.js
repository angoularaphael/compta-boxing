export const MOBILE_TABS = [
  { href: '/admin', label: 'Tableau', icon: 'dashboard', exact: true },
  { href: '/admin/match', label: 'Rapproch.', icon: 'match' },
];

export function isTabActive(pathname, href, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
