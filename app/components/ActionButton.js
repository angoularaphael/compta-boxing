'use client';

export default function ActionButton({
  loading = false,
  disabled = false,
  className = 'btn',
  children,
  type = 'button',
  ...props
}) {
  const busy = loading || disabled;
  return (
    <button type={type} className={className} disabled={busy} aria-busy={loading || undefined} {...props}>
      {children}
    </button>
  );
}
