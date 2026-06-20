'use client';

import { useState } from 'react';

export default function PasswordField({ id, value, onChange, disabled, required, autoComplete = 'current-password' }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input-wrap">
      <input
        id={id}
        name={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        disabled={disabled}
        required={required}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      >
        {visible ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.7 10.7 0 0 1 12 5c5 0 9.3 3.1 11 7.5a11.8 11.8 0 0 1-2.1 3.4M6.7 6.7A11.5 11.5 0 0 0 3 12.5C4.7 16.9 9 20 14 20c1.5 0 2.9-.3 4.2-.8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M2 12.5C3.7 8.1 8 5 13 5s9.3 3.1 11 7.5c-1.7 4.4-6 7.5-11 7.5S3.7 16.9 2 12.5z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="13" cy="12.5" r="3" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        )}
      </button>
    </div>
  );
}
