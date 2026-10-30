"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { localeLabels, locales } from "@/i18n/config";
import { swapLocaleInPath } from "@/i18n/path";
import { useI18n } from "@/i18n/provider";

export function LanguageSwitcher() {
  const pathname = usePathname() ?? "/";
  const { locale, messages } = useI18n();

  return (
    <nav aria-label={messages.nav.languageSwitcher}>
      <ul className="flex items-center gap-1 rounded-full border border-border p-1">
        {locales.map((target) => {
          const isActive = target === locale;

          return (
            <li key={target}>
              <Button
                variant={isActive ? "default" : "ghost"}
                size="sm"
                className="rounded-full"
                render={
                  <Link
                    href={swapLocaleInPath(pathname, target)}
                    hrefLang={target}
                    lang={target}
                    aria-current={isActive ? "true" : undefined}
                  />
                }
              >
                {localeLabels[target]}
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
