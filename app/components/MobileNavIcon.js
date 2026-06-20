export default function MobileNavIcon({ name, active = false }) {
  const stroke = 'currentColor';

  switch (name) {
    case 'dashboard':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="8" height="8" rx="1.5" stroke={stroke} strokeWidth="1.8" />
          <rect x="13" y="3" width="8" height="5" rx="1.5" stroke={stroke} strokeWidth="1.8" />
          <rect x="13" y="10" width="8" height="11" rx="1.5" stroke={stroke} strokeWidth="1.8" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" stroke={stroke} strokeWidth="1.8" />
        </svg>
      );
    case 'match':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 7h10M7 12h6M7 17h8" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M17 12l3 3-3 3" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'logout':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M14 12H4" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M18 8l4 4-4 4" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}
