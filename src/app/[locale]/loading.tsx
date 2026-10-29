"use client";

import { useI18n } from "@/i18n/provider";

export default function Loading() {
  const { messages } = useI18n();

  return (
    <main
      aria-busy="true"
      className="mx-auto flex min-h-dvh w-full max-w-5xl items-center justify-center px-6 py-24"
    >
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {messages.states.loading}
      </p>
    </main>
  );
}
