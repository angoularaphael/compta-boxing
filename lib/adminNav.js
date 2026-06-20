export const ADMIN_NAV = [
  {
    label: 'Menu',
    sectionClass: 'menu-section',
    links: [
      { href: '/admin', text: 'Mes factures', icon: 'dashboard', featured: true },
      { href: '/admin/whatsapp', text: 'Connexion WhatsApp', icon: 'whatsapp' },
      { href: '/admin/match', text: 'Vérifier le mois', icon: 'match' },
    ],
  },
];

export const PAGE_TITLES = {
  '/admin': 'Mes factures',
  '/admin/whatsapp': 'Connexion WhatsApp',
  '/admin/match': 'Vérifier le mois',
};

export function titleForPath(pathname) {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/admin' && pathname.startsWith(path)) return title;
  }
  return 'Compta Boxing';
}
