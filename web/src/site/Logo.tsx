export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="logo" style={{ color: dark ? "#fff" : "var(--ink)" }}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <rect width="22" height="22" rx="6" fill="var(--ember)" />
        <path d="M6 15.5V9.5a5 5 0 0 1 10 0v6l-1.7-1.3-1.6 1.3-1.7-1.3-1.7 1.3-1.6-1.3z" fill="#fff" />
        <circle cx="9.2" cy="10" r="1.1" fill="var(--ember)" />
        <circle cx="12.8" cy="10" r="1.1" fill="var(--ember)" />
      </svg>
      Ghost Leads
    </span>
  );
}
