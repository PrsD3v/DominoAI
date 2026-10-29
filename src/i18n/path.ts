import { defaultLocale, isLocale, type Locale } from "./config";

export function swapLocaleInPath(pathname: string, target: Locale): string {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return `/${target}`;
  }

  if (isLocale(segments[0])) {
    segments[0] = target;
  } else {
    segments.unshift(target);
  }

  return `/${segments.join("/")}`;
}

export function localeFromPath(pathname: string): Locale {
  const [first] = pathname.split("/").filter(Boolean);
  return isLocale(first) ? first : defaultLocale;
}
