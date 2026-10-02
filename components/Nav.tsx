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
    <nav className="nav">
      <span className="brand">ATLAXIS</span>
      {sending
        ? null
        : LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={pathname === link.href ? "active" : ""}>
              {link.label}
            </Link>
          ))}
    </nav>
  );
}
