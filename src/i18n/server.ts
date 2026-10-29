import { locale as rootLocale } from "next/root-params";
import { defaultLocale, getDirection, isLocale } from "./config";
import { getMessages } from "./messages";
import type { I18nValue } from "./provider";

export async function getI18n(): Promise<I18nValue> {
  const raw = await rootLocale();
  const locale = isLocale(raw) ? raw : defaultLocale;

  return {
    locale,
    dir: getDirection(locale),
    messages: getMessages(locale),
  };
}
