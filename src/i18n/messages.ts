import type { Locale } from "./config";

const en = {
  meta: {
    title: "DominoAI - Workflow control for AI coding agents",
    description: "Local-first workflow control for AI coding agents.",
  },
  nav: {
    brand: "DominoAI",
    tagline: "Workflow control for AI coding agents",
    languageSwitcher: "Language",
    settings: "Settings",
  },
  home: {
    eyebrow: "Foundation",
    title: "Workflow control, on your machine",
    description:
      "Domino defines and manages multi-step workflows for AI coding agents. A runtime such as Reasonix executes the steps, while Domino owns the state, the approvals, and the history.",
    plannedBadge: "Planned",
    cards: {
      projects: {
        title: "Projects",
        description:
          "Register a workspace and pin the workflow and skill versions it uses.",
      },
      workflows: {
        title: "Workflows",
        description:
          "Define versioned steps, approval points, and error policy once, then reuse them across projects.",
      },
      runs: {
        title: "Runs",
        description:
          "Start a run, follow live events, pause, continue, cancel, and read the history later.",
      },
    },
    foundation: {
      title: "Localization is active",
      body: "This shell is rendered on the server in both languages. Dashboard screens use the same translation catalog as they are built.",
    },
  },
  settings: {
    title: "Settings",
    intro:
      "Configure the Reasonix runtime profiles on this machine. Everything stays local.",
    localOnly:
      "Providers and credentials come from your local Reasonix installation. Domino never stores a key.",
    loading: "Loading settings",
    emptyProfiles:
      "No runtime profiles yet. Create one below to choose a Reasonix provider and model.",
    refresh: "Refresh",
    retry: "Try again",
    sections: {
      profiles: "Runtime profiles",
      createProfile: "New runtime profile",
      editProfile: "Edit runtime profile",
    },
    fields: {
      label: "Profile label",
      labelHelp: "A local name for this profile. It is not sent to the provider.",
      provider: "Provider",
      model: "Model",
      apiKey: "API key",
      apiKeyHelp:
        "The key is written to the Reasonix environment file and is never read back.",
      labelRequired: "Enter a profile label.",
      providerRequired: "Choose a provider.",
      modelRequired: "Choose a model.",
      apiKeyRequired: "Enter an API key.",
    },
    actions: {
      create: "Create profile",
      save: "Save profile",
      saving: "Saving",
      edit: "Edit",
      cancel: "Cancel",
      setKey: "Save key",
      savingKey: "Saving key",
      removeKey: "Remove key",
      removingKey: "Removing key",
    },
    status: {
      label: "Credential",
      missing: "Missing",
      present: "Present",
      unknown: "Unknown",
      presenceOnly:
        "Present means a key exists in the Reasonix environment file. It does not prove the key works.",
    },
    groups: {
      apiKeyEnv: "Environment variable",
      profileCount: "Profiles in this group",
      sharedKey: "This key is shared by every profile in this group.",
      noProfiles: "No profiles use this key yet.",
    },
    connection: {
      test: "Test connection",
      testing: "Testing connection",
      succeeded: "The connection test succeeded.",
      failed: "The connection test failed.",
      hint:
        "The test sends one short prompt to the selected provider and may incur a small charge.",
      errors: {
        credential_missing:
          "No API key is stored for this profile's environment variable.",
        invalid_profile:
          "The saved profile is not valid. Edit it before testing again.",
        workspace_unavailable:
          "A temporary read-only workspace could not be prepared.",
        runtime_unavailable:
          "The Reasonix runtime did not start or complete its handshake.",
        session_failed:
          "Reasonix could not create a session for the test workspace.",
        prompt_failed:
          "The test prompt failed. The provider rejected it or returned an error.",
        cancelled: "The test prompt was cancelled before it completed.",
        timeout: "The connection test did not finish in time.",
      },
    },
    notices: {
      catalogUnavailable:
        "The Reasonix provider catalog could not be read. Check the Reasonix installation and try again.",
      profilesUnavailable: "The runtime profiles could not be read. Try again.",
      noSelectableProvider:
        "No Reasonix provider reports an API-key environment name, so a profile cannot be created.",
      selectionUnavailable:
        "The saved provider or model is no longer reported by Reasonix. Choose an available pair to update this profile.",
      createUnavailable:
        "Profile creation is unavailable until the provider catalog loads.",
    },
    feedback: {
      profileCreated: "Profile created.",
      profileUpdated: "Profile updated.",
      credentialSaved: "API key saved.",
      credentialRemoved: "API key removed.",
    },
    errors: {
      invalid_request: "Some settings fields are invalid.",
      invalid_json: "The settings request body could not be read.",
      unsupported_media_type: "The settings request was not sent as JSON.",
      invalid_secret:
        "The key format is not accepted. Use a single token with no spaces or quotes.",
      profile_not_found: "That runtime profile no longer exists.",
      project_not_found: "That project no longer exists.",
      provider_unknown: "The selected provider is no longer available.",
      model_unknown:
        "The selected model is no longer available for this provider.",
      api_key_env_unknown:
        "The provider does not report an API-key environment name.",
      catalog_unavailable: "The Reasonix provider catalog is unavailable.",
      credential_path_rejected:
        "The Reasonix home directory cannot be used for credentials.",
      credential_file_invalid: "The Reasonix credential file is malformed.",
      credential_conflict:
        "The Reasonix credential file changed during the save. Try again.",
      credential_locked:
        "Another process is writing the Reasonix credential file. Try again.",
      credential_unavailable: "The Reasonix credential file is unavailable.",
      persistence_error: "The runtime profile store is unavailable.",
      network: "The settings service could not be reached.",
      unexpected: "The settings request failed unexpectedly.",
    },
  },
  states: {
    loading: "Loading",
    errorTitle: "Something went wrong",
    errorBody:
      "The interface could not render. The original technical message is kept unchanged below.",
    retry: "Try again",
    notFoundTitle: "Page not found",
    notFoundBody: "This route does not exist in the current language.",
    backHome: "Back to the dashboard",
  },
  a11y: {
    skipToContent: "Skip to content",
  },
  footer: {
    note: "Local-first. MIT licensed. Runs on your machine.",
  },
};

export type Messages = typeof en;

const fa: Messages = {
  meta: {
    title: "DominoAI - کنترل گردش‌کار برای ایجنت‌های کدنویسی هوش مصنوعی",
    description: "کنترل گردش‌کار محلی برای ایجنت‌های کدنویسی هوش مصنوعی.",
  },
  nav: {
    brand: "DominoAI",
    tagline: "کنترل گردش‌کار برای ایجنت‌های کدنویسی هوش مصنوعی",
    languageSwitcher: "زبان",
    settings: "تنظیمات",
  },
  home: {
    eyebrow: "زیرساخت",
    title: "کنترل گردش‌کار، روی سیستم خودت",
    description:
      "Domino گردش‌کارهای چندمرحله‌ای برای ایجنت‌های کدنویسی هوش مصنوعی را تعریف و مدیریت می‌کند. Runtimeهایی مانند Reasonix مراحل را اجرا می‌کنند و Domino مالک وضعیت، تأییدها و تاریخچه است.",
    plannedBadge: "در برنامه",
    cards: {
      projects: {
        title: "پروژه‌ها",
        description:
          "یک workspace ثبت کن و نسخه‌های Workflow و Skill مورد استفاده را به آن متصل کن.",
      },
      workflows: {
        title: "گردش‌کارها",
        description:
          "مراحل نسخه‌بندی‌شده، نقاط تأیید و سیاست خطا را یک‌بار تعریف کن و در چند پروژه استفاده کن.",
      },
      runs: {
        title: "اجراها",
        description:
          "یک اجرا را شروع کن، رویدادهای زنده را ببین، متوقف و ادامه بده، لغو کن و بعداً تاریخچه را بخوان.",
      },
    },
    foundation: {
      title: "دوزبانه‌سازی فعال است",
      body: "این پوسته برای هر دو زبان روی سرور رندر می‌شود. صفحه‌های داشبورد هنگام ساخت از همین کاتالوگ ترجمه استفاده می‌کنند.",
    },
  },
  settings: {
    title: "تنظیمات",
    intro:
      "پروفایل‌های Runtime مربوط به Reasonix را روی این سیستم تنظیم کن. همه‌چیز محلی می‌ماند.",
    localOnly:
      "Providerها و اعتبارنامه‌ها از نصب محلی Reasonix خوانده می‌شوند. Domino هیچ کلیدی را ذخیره نمی‌کند.",
    loading: "در حال بارگذاری تنظیمات",
    emptyProfiles:
      "هنوز پروفایل Runtime وجود ندارد. برای انتخاب Provider و مدل Reasonix یکی بساز.",
    refresh: "به‌روزرسانی",
    retry: "تلاش دوباره",
    sections: {
      profiles: "پروفایل‌های Runtime",
      createProfile: "پروفایل Runtime جدید",
      editProfile: "ویرایش پروفایل Runtime",
    },
    fields: {
      label: "نام پروفایل",
      labelHelp: "یک نام محلی برای این پروفایل. این نام به Provider ارسال نمی‌شود.",
      provider: "Provider",
      model: "مدل",
      apiKey: "کلید API",
      apiKeyHelp:
        "کلید در فایل محیطی Reasonix نوشته می‌شود و هرگز بازخوانی نمی‌شود.",
      labelRequired: "نام پروفایل را وارد کن.",
      providerRequired: "یک Provider انتخاب کن.",
      modelRequired: "یک مدل انتخاب کن.",
      apiKeyRequired: "کلید API را وارد کن.",
    },
    actions: {
      create: "ساخت پروفایل",
      save: "ذخیره پروفایل",
      saving: "در حال ذخیره",
      edit: "ویرایش",
      cancel: "انصراف",
      setKey: "ذخیره کلید",
      savingKey: "در حال ذخیره کلید",
      removeKey: "حذف کلید",
      removingKey: "در حال حذف کلید",
    },
    status: {
      label: "اعتبارنامه",
      missing: "موجود نیست",
      present: "موجود است",
      unknown: "نامشخص",
      presenceOnly:
        "«موجود است» یعنی کلیدی در فایل محیطی Reasonix هست. این وضعیت درستی کلید را ثابت نمی‌کند.",
    },
    groups: {
      apiKeyEnv: "متغیر محیطی",
      profileCount: "تعداد پروفایل در این گروه",
      sharedKey: "این کلید بین همهٔ پروفایل‌های این گروه مشترک است.",
      noProfiles: "هنوز هیچ پروفایلی از این کلید استفاده نمی‌کند.",
    },
    connection: {
      test: "آزمایش اتصال",
      testing: "در حال آزمایش اتصال",
      succeeded: "آزمایش اتصال موفق بود.",
      failed: "آزمایش اتصال ناموفق بود.",
      hint:
        "این آزمایش یک درخواست کوتاه به Provider انتخاب‌شده می‌فرستد و ممکن است هزینهٔ کمی داشته باشد.",
      errors: {
        credential_missing:
          "برای متغیر محیطی این پروفایل هیچ کلید API ذخیره نشده است.",
        invalid_profile:
          "پروفایل ذخیره‌شده معتبر نیست. پیش از آزمایش دوباره آن را ویرایش کن.",
        workspace_unavailable:
          "پوشهٔ موقت و فقط‌خواندنی برای آزمایش ساخته نشد.",
        runtime_unavailable:
          "Runtime مربوط به Reasonix شروع نشد یا دست‌دادن اولیه را کامل نکرد.",
        session_failed:
          "Reasonix نتوانست برای پوشهٔ آزمایش نشست بسازد.",
        prompt_failed:
          "درخواست آزمایش شکست خورد. Provider آن را رد کرد یا خطا برگرداند.",
        cancelled: "درخواست آزمایش پیش از پایان لغو شد.",
        timeout: "آزمایش اتصال در زمان مجاز تمام نشد.",
      },
    },
    notices: {
      catalogUnavailable:
        "کاتالوگ Providerهای Reasonix خوانده نشد. نصب Reasonix را بررسی کن و دوباره تلاش کن.",
      profilesUnavailable: "پروفایل‌های Runtime خوانده نشدند. دوباره تلاش کن.",
      noSelectableProvider:
        "هیچ Provider مربوط به Reasonix نام متغیر کلید API را گزارش نکرده است، بنابراین ساخت پروفایل ممکن نیست.",
      selectionUnavailable:
        "Provider یا مدل ذخیره‌شده دیگر توسط Reasonix گزارش نمی‌شود. برای به‌روزرسانی این پروفایل یک جفت در دسترس انتخاب کن.",
      createUnavailable:
        "ساخت پروفایل تا بارگذاری کاتالوگ Providerها ممکن نیست.",
    },
    feedback: {
      profileCreated: "پروفایل ساخته شد.",
      profileUpdated: "پروفایل به‌روزرسانی شد.",
      credentialSaved: "کلید API ذخیره شد.",
      credentialRemoved: "کلید API حذف شد.",
    },
    errors: {
      invalid_request: "بعضی فیلدهای تنظیمات معتبر نیستند.",
      invalid_json: "بدنهٔ درخواست تنظیمات خوانده نشد.",
      unsupported_media_type: "درخواست تنظیمات به‌صورت JSON ارسال نشد.",
      invalid_secret:
        "قالب کلید پذیرفته نیست. یک توکن بدون فاصله یا کوتیشن وارد کن.",
      profile_not_found: "آن پروفایل Runtime دیگر وجود ندارد.",
      project_not_found: "آن پروژه دیگر وجود ندارد.",
      provider_unknown: "Provider انتخاب‌شده دیگر در دسترس نیست.",
      model_unknown: "مدل انتخاب‌شده دیگر برای این Provider در دسترس نیست.",
      api_key_env_unknown:
        "Provider نام متغیر محیطی کلید API را گزارش نمی‌کند.",
      catalog_unavailable: "کاتالوگ Providerهای Reasonix در دسترس نیست.",
      credential_path_rejected:
        "پوشهٔ خانهٔ Reasonix برای اعتبارنامه‌ها قابل استفاده نیست.",
      credential_file_invalid: "فایل اعتبارنامهٔ Reasonix معتبر نیست.",
      credential_conflict:
        "فایل اعتبارنامهٔ Reasonix هنگام ذخیره تغییر کرد. دوباره تلاش کن.",
      credential_locked:
        "فرایند دیگری در حال نوشتن فایل اعتبارنامهٔ Reasonix است. دوباره تلاش کن.",
      credential_unavailable: "فایل اعتبارنامهٔ Reasonix در دسترس نیست.",
      persistence_error: "مخزن پروفایل Runtime در دسترس نیست.",
      network: "سرویس تنظیمات در دسترس نبود.",
      unexpected: "درخواست تنظیمات به‌طور غیرمنتظره شکست خورد.",
    },
  },
  states: {
    loading: "در حال بارگذاری",
    errorTitle: "خطایی رخ داد",
    errorBody:
      "رابط کاربری نتوانست رندر شود. پیام فنی اصلی بدون تغییر در پایین نمایش داده می‌شود.",
    retry: "تلاش دوباره",
    notFoundTitle: "صفحه پیدا نشد",
    notFoundBody: "این مسیر در زبان فعلی وجود ندارد.",
    backHome: "بازگشت به داشبورد",
  },
  a11y: {
    skipToContent: "پرش به محتوا",
  },
  footer: {
    note: "محلی‌محور. با لایسنس MIT. روی سیستم خودت اجرا می‌شود.",
  },
};

export { en, fa };

export function getMessages(locale: Locale): Messages {
  return locale === "fa" ? fa : en;
}
