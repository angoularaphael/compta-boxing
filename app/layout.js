import AppBoot from './components/AppBoot';
import './globals.css';
import './ik-chat.css';
import './compta.css';

export const metadata = {
  title: 'Compta Boxing — 3 salles',
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
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
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
