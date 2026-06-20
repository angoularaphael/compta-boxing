export const MOBILE_TABS = [
  { href: '/admin', label: 'Factures', icon: 'dashboard', exact: true },
  { href: '/admin/whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
  { href: '/admin/match', label: 'Vérifier', icon: 'match' },
];

export function isTabActive(pathname, href, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
