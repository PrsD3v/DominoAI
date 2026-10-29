"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/provider";

export default function NotFound() {
  const { locale, messages } = useI18n();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold">
        {messages.states.notFoundTitle}
      </h1>
      <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {messages.states.notFoundBody}
      </p>
      <Link
        href={`/${locale}`}
        className="mt-6 w-fit rounded-full border border-black/10 px-4 py-2 text-sm font-medium dark:border-white/15"
      >
        {messages.states.backHome}
      </Link>
    </main>
  );
}
