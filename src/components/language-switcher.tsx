"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { localeLabels, locales } from "@/i18n/config";
import { swapLocaleInPath } from "@/i18n/path";
import { useI18n } from "@/i18n/provider";

export function LanguageSwitcher() {
  const pathname = usePathname() ?? "/";
  const { locale, messages } = useI18n();

  return (
    <nav aria-label={messages.nav.languageSwitcher}>
      <ul className="flex items-center gap-1 rounded-full border border-black/10 p-1 dark:border-white/15">
        {locales.map((target) => {
          const isActive = target === locale;

          return (
            <li key={target}>
              <Link
                href={swapLocaleInPath(pathname, target)}
                hrefLang={target}
                lang={target}
                aria-current={isActive ? "true" : undefined}
                className={`block rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-foreground text-background"
                    : "text-zinc-600 hover:text-foreground dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {localeLabels[target]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
