export const ADMIN_NAV = [
  {
    label: 'Menu',
    sectionClass: 'menu-section',
    links: [
      { href: '/admin', text: 'Tableau de bord', icon: 'dashboard', featured: true },
      { href: '/admin/match', text: 'Rapprochement', icon: 'match' },
    ],
  },
];

export const PAGE_TITLES = {
  '/admin': 'Tableau de bord',
  '/admin/match': 'Rapprochement',
};

export function titleForPath(pathname) {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/admin' && pathname.startsWith(path)) return title;
  }
  return 'Compta Boxing';
}
