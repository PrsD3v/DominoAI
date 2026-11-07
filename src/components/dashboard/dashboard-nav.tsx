"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/utils";

function isActive(pathname: string, locale: string, segment: string): boolean {
  const base = `/${locale}/${segment}`;

  return pathname === base || pathname.startsWith(`${base}/`);
}

export function DashboardNav() {
  const pathname = usePathname() ?? "/";
  const { locale, messages } = useI18n();
  const items = [
    { segment: "projects", label: messages.nav.projects },
    { segment: "workflows", label: messages.nav.workflows },
    { segment: "runs", label: messages.nav.runs },
    { segment: "settings", label: messages.nav.settings },
  ] as const;

  return (
    <nav aria-label={messages.nav.primary}>
      <ul className="flex flex-wrap items-center gap-1">
        {items.map((item) => {
          const active = isActive(pathname, locale, item.segment);

          return (
            <li key={item.segment}>
              <Link
                href={`/${locale}/${item.segment}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
