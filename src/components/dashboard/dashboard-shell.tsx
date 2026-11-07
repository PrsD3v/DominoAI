import Link from "next/link";
import type { ReactNode } from "react";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getI18n } from "@/i18n/server";

export async function DashboardShell({ children }: { children: ReactNode }) {
  const { locale, messages } = await getI18n();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:text-background"
      >
        {messages.a11y.skipToContent}
      </a>

      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <Link
            href={`/${locale}/runs`}
            aria-label={messages.nav.brand}
            className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-lg bg-foreground text-sm font-semibold text-background"
            >
              D
            </span>
            <span>
              <span className="block text-sm font-semibold leading-5">
                {messages.nav.brand}
              </span>
              <span className="block text-xs leading-4 text-muted-foreground">
                {messages.nav.tagline}
              </span>
            </span>
          </Link>

          <div className="flex flex-wrap items-center gap-3">
            <DashboardNav />
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-4 text-xs text-muted-foreground">
          {messages.footer.note}
        </div>
      </footer>
    </div>
  );
}
