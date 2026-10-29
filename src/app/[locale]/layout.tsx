import type { Metadata } from "next";
import { Geist, Geist_Mono, Vazirmatn } from "next/font/google";
import { notFound } from "next/navigation";
import { getDirection, isLocale, locales } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { I18nProvider } from "@/i18n/provider";
import "../globals.css";

const latinSans = Geist({
  variable: "--font-latin-sans",
  subsets: ["latin"],
});

const latinMono = Geist_Mono({
  variable: "--font-latin-mono",
  subsets: ["latin"],
});

const persianSans = Vazirmatn({
  variable: "--font-persian-sans",
  subsets: ["arabic", "latin"],
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) {
    return {};
  }

  const messages = getMessages(locale);

  return {
    title: messages.meta.title,
    description: messages.meta.description,
  };
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  const dir = getDirection(locale);
  const messages = getMessages(locale);

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${latinSans.variable} ${latinMono.variable} ${persianSans.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <I18nProvider value={{ locale, dir, messages }}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
