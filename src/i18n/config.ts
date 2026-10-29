export const locales = ["fa", "en"] as const;

export type Locale = (typeof locales)[number];

export type Direction = "rtl" | "ltr";

export const defaultLocale: Locale = "en";

export const localeCookieName = "domino.locale";

export const localeLabels: Record<Locale, string> = {
  fa: "فارسی",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function getDirection(locale: Locale): Direction {
  return locale === "fa" ? "rtl" : "ltr";
}
