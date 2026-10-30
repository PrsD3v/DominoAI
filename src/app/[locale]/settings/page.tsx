import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { Button } from "@/components/ui/button";
import { getI18n } from "@/i18n/server";

export default async function SettingsPage() {
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
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-lg bg-foreground text-sm font-semibold text-background"
            >
              D
            </span>
            <div>
              <p className="text-sm font-semibold leading-5">
                {messages.nav.brand}
              </p>
              <p className="text-xs leading-4 text-muted-foreground">
                {messages.nav.tagline}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/${locale}`} />}
            >
              {messages.states.backHome}
            </Button>
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {messages.nav.settings}
        </p>
        <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          {messages.settings.title}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          {messages.settings.intro}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {messages.settings.localOnly}
        </p>

        <SettingsScreen />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-6 py-4 text-xs text-muted-foreground">
          {messages.footer.note}
        </div>
      </footer>
    </div>
  );
}
