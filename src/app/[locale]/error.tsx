"use client";

import { useI18n } from "@/i18n/provider";

export default function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { messages } = useI18n();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold">{messages.states.errorTitle}</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {messages.states.errorBody}
      </p>
      <pre
        dir="ltr"
        className="mt-6 overflow-x-auto rounded-lg border border-black/10 bg-black/[0.03] p-4 text-start text-xs dark:border-white/15 dark:bg-white/[0.04]"
      >
        <code>{error.message}</code>
      </pre>
      <button
        type="button"
        onClick={reset}
        className="mt-6 w-fit rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
      >
        {messages.states.retry}
      </button>
    </main>
  );
}
