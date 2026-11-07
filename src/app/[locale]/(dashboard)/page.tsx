import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";

export default async function DashboardHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  redirect(`/${locale}/runs`);
}
