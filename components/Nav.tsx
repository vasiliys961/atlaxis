"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Документы" },
  { href: "/report", label: "Разбор" },
];

export function Nav() {
  const pathname = usePathname();
  const sending = pathname.startsWith("/phone");
  return (
    <header className="top">
      <Link className="brand" href="/" aria-label="На главную">
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill="rgba(255,252,246,.8)" stroke="#12211b" strokeWidth="1.6" />
          <circle cx="20" cy="20" r="12" stroke="#2b6a54" strokeWidth="1.2" strokeDasharray="2 3.2" />
          <path d="M20 5l4.2 15L20 35l-4.2-15z" fill="#12211b" />
          <path d="M20 5l4.2 15h-8.4z" fill="#b5744b" />
          <circle cx="20" cy="20" r="2.2" fill="#fffcf6" />
        </svg>
        <span>
          <b>ATLAXIS</b>
          <small>личный AI-ассистент по здоровью</small>
        </span>
      </Link>
      {sending ? null : (
        <nav className="tabs" aria-label="Разделы">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={pathname === link.href ? "active" : ""}>
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
