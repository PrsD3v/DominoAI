import { SettingsScreen } from "@/components/settings/settings-screen";
import { getI18n } from "@/i18n/server";

export default async function SettingsPage() {
  const { messages } = await getI18n();

  return (
    <>
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
    </>
  );
}
