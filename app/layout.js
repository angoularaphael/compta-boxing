import AppBoot from './components/AppBoot';
import './globals.css';
import './compta.css';

export const metadata = {
  title: 'Compta Boxing — 4 salles',
  description: 'Factures d\'achat WhatsApp, rapprochement bancaire, export comptable',
  applicationName: 'Compta Boxing',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Compta Boxing',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>
        <AppBoot>{children}</AppBoot>
      </body>
    </html>
  );
}
