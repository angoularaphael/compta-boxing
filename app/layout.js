import './globals.css';

export const metadata = {
  title: 'Compta Boxing — 4 salles',
  description: 'Collecte factures WhatsApp, rapprochement bancaire, export comptable',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
