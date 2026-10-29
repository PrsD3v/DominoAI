import { LanguageSwitcher } from "@/components/language-switcher";
import { getI18n } from "@/i18n/server";

export default async function HomePage() {
  const { messages } = await getI18n();
  const cards = [
    messages.home.cards.projects,
    messages.home.cards.workflows,
    messages.home.cards.runs,
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:text-background"
      >
        {messages.a11y.skipToContent}
      </a>

      <header className="border-b border-black/10 dark:border-white/15">
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
              <p className="text-xs leading-4 text-zinc-600 dark:text-zinc-400">
                {messages.nav.tagline}
              </p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          {messages.home.eyebrow}
        </p>
        <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          {messages.home.title}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          {messages.home.description}
        </p>

        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <article
              key={card.title}
              className="rounded-xl border border-black/10 p-5 dark:border-white/15"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{card.title}</h2>
                <span className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-white/15 dark:text-zinc-400">
                  {messages.home.plannedBadge}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {card.description}
              </p>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-xl border border-black/10 bg-white/60 p-6 dark:border-white/15 dark:bg-white/[0.03]">
          <h2 className="text-sm font-semibold">
            {messages.home.foundation.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {messages.home.foundation.body}
          </p>
        </section>
      </main>

      <footer className="border-t border-black/10 dark:border-white/15">
        <div className="mx-auto w-full max-w-5xl px-6 py-4 text-xs text-zinc-500">
          {messages.footer.note}
        </div>
      </footer>
    </div>
  );
}
