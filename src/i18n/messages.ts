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
