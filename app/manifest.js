export default function manifest() {
  return {
    name: 'Compta Boxing — 4 salles',
    short_name: 'Compta Boxing',
    description: 'Factures d\'achat, rapprochement bancaire, export comptable',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    lang: 'fr',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
