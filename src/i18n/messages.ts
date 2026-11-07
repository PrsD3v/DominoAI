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
    primary: "Primary",
    projects: "Projects",
    workflows: "Workflows",
    runs: "Runs",
    settings: "Settings",
  },
  common: {
    refresh: "Refresh",
    retry: "Try again",
    loading: "Loading",
    save: "Save",
    saving: "Saving",
    cancel: "Cancel",
    back: "Back",
    none: "None",
    unknown: "Unknown",
    notAvailable: "Not available",
    required: "Required",
    optional: "Optional",
    noItems: "Nothing to show yet.",
  },
  statuses: {
    run: {
      pending: "Pending",
      running: "Running",
      paused: "Paused",
      waiting_approval: "Waiting for approval",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
      interrupted: "Interrupted",
    },
    step: {
      pending: "Pending",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    },
    approval: {
      pending: "Pending",
      approved: "Approved",
      rejected: "Rejected",
      cancelled: "Cancelled",
    },
    stream: {
      connecting: "Connecting to live events",
      live: "Live events connected",
      reconnecting: "Live connection lost. Reconnecting.",
      ended: "Run finished; live events closed",
    },
  },
  historyKinds: {
    run_started: "Run started",
    run_paused: "Run paused",
    run_continued: "Run continued",
    run_cancelled: "Run cancelled",
    run_completed: "Run completed",
    run_failed: "Run failed",
    run_interrupted: "Run interrupted",
    step_started: "Step started",
    step_attempt_failed: "Step attempt failed",
    step_completed: "Step completed",
    step_failed: "Step failed",
    step_cancelled: "Step cancelled",
    session_close_failed: "Session close failed",
    containment_refused: "Step refused outside the workspace",
    approval_requested: "Approval requested",
    approval_approved: "Approval granted",
    approval_rejected: "Approval rejected",
    approval_cancelled: "Approval cancelled",
  },
  runErrors: {
    invalid_request: "Some fields are invalid.",
    invalid_json: "The request body could not be read.",
    unsupported_media_type: "The request was not sent as JSON.",
    project_not_found: "That project no longer exists.",
    workflow_version_not_found: "That workflow version no longer exists.",
    skill_version_not_found: "A selected skill version no longer exists.",
    workspace_root_invalid:
      "The workspace root cannot be used. Choose an existing directory.",
    workspace_root_registered:
      "That workspace is already registered as a project.",
    runtime_profile_not_found: "That runtime profile no longer exists.",
    runtime_profile_required:
      "This project has no default runtime profile. Set one in Projects.",
    runtime_profile_invalid:
      "The project's runtime profile is invalid. Review it in Settings.",
    credential_missing:
      "The runtime profile has no stored API key. Set one in Settings.",
    workflow_version_not_selected:
      "That workflow version is not selected for this project.",
    workflow_version_invalid: "The workflow version cannot be executed.",
    skill_version_missing:
      "A skill version required by this workflow is missing.",
    run_not_found: "That run no longer exists.",
    run_busy: "Another run is already active. Wait for it to finish.",
    run_state_conflict: "The run changed. Reload and try again.",
    approval_not_found: "That approval no longer exists.",
    approval_already_resolved: "That approval was already answered.",
    persistence_error: "The workflow store is unavailable.",
    runtime_unavailable: "The Reasonix runtime did not start.",
    network: "The local service could not be reached.",
    unexpected: "The request failed unexpectedly.",
  },
  projects: {
    title: "Projects",
    intro:
      "Register workspaces and pin the workflow and skill versions they run.",
    listTitle: "Registered projects",
    emptyTitle: "No projects yet",
    emptyBody:
      "Register a workspace below, choose its workflow versions, and give it a default runtime profile so it can start a run.",
    registerTitle: "Register a project",
    registerIntro:
      "The workspace root must already exist on this machine. Domino stores its canonical path.",
    fields: {
      name: "Project name",
      nameHelp: "A local label for this workspace.",
      workspaceRoot: "Workspace root",
      workspaceRootHelp:
        "An absolute path to the existing project directory.",
      defaultProfile: "Default runtime profile",
      defaultProfileHelp:
        "Runs use this profile. You can change it later from the project list.",
      workflowVersions: "Workflow versions",
      workflowVersionsHelp:
        "Select at least one published version. Only these versions can run in this project.",
      skillVersions: "Skill versions",
      skillVersionsHelp: "Optional selections recorded with the project.",
      nameRequired: "Enter a project name.",
      workspaceRootRequired: "Enter an existing workspace directory.",
      workflowVersionsRequired: "Select at least one workflow version.",
      defaultProfileRequired: "Choose an available runtime profile.",
      skillVersionsRequired: "Choose available skill versions.",
    },
    options: {
      noProfile: "No default profile",
    },
    actions: {
      register: "Register project",
      registering: "Registering",
      saveProfile: "Save profile",
      savingProfile: "Saving profile",
    },
    lists: {
      workflowVersions: "Workflow versions",
      skillVersions: "Skill versions",
      registeredAt: "Registered",
      noSkills: "No skill versions selected.",
    },
    feedback: {
      created: "Project registered.",
      profileUpdated: "Default runtime profile updated.",
    },
    notices: {
      noWorkflows:
        "No published workflow versions are available. Publish a version before registering a project.",
      noProfiles:
        "No runtime profiles exist yet. Create one in Settings before a run can start.",
      noSkillVersions: "No published skill versions are available.",
    },
  },
  workflows: {
    title: "Workflows",
    intro:
      "Published workflow definitions and their versions. This screen is read-only.",
    emptyTitle: "No workflows published",
    emptyBody:
      "No workflow definitions exist yet. Publishing is not available from the dashboard.",
    latestBadge: "Latest",
    definitionsTitle: "Published workflows",
    versionsTitle: "Versions",
    versionLabel: "Version",
    stepsTitle: "Steps",
    approvalPointsTitle: "Approval points",
    noApprovalPoints: "No approval points.",
    skillVersionsTitle: "Skill versions",
    noSkillVersions: "No skill versions.",
    lastRunTitle: "Last run",
    noRuns: "No runs yet.",
    publishedAt: "Published",
    noVersions: "No published versions.",
    stepLabel: "Step",
  },
  runs: {
    title: "Runs",
    intro:
      "Start a workflow against a registered project and follow its live state.",
    listTitle: "Run history",
    emptyTitle: "No runs yet",
    emptyBody:
      "Start a workflow below. The list keeps the run state and history.",
    startTitle: "Start a run",
    startIntro:
      "Choose a registered project and one of its selected workflow versions.",
    fields: {
      project: "Project",
      workflowVersion: "Workflow version",
      projectHelp: "Only registered projects appear here.",
      workflowVersionHelp:
        "Only versions selected for that project can run.",
      projectRequired: "Choose a project.",
      workflowVersionRequired: "Choose a workflow version.",
    },
    actions: {
      start: "Start run",
      starting: "Starting",
      open: "Open run",
      reload: "Reload run",
    },
    list: {
      project: "Project",
      workflow: "Workflow",
      status: "Status",
      created: "Created",
      duration: "Duration",
      actions: "Actions",
      unknownProject: "Unknown project",
    },
    notices: {
      noProjects: "Register a project before starting a run.",
      noVersions: "This project has no selected workflow versions.",
      noProfile:
        "This project has no default runtime profile. Set one in Projects.",
    },
    detail: {
      runId: "Run id",
      project: "Project",
      workflow: "Workflow",
      workspace: "Workspace",
      status: "Status",
      created: "Created",
      started: "Started",
      finished: "Finished",
      elapsed: "Elapsed",
      stepsTitle: "Steps",
      approvalsTitle: "Approvals",
      controlsTitle: "Run controls",
      eventsTitle: "Live events",
      historyTitle: "History",
      noSteps: "No steps have been recorded yet.",
      noApprovals: "No approvals have been requested.",
      noEvents: "No runtime events yet.",
      noHistory: "No history yet.",
      result: "Result",
      error: "Error",
      attempts: "Attempts",
      stepLabel: "Step",
      approve: "Approve",
      reject: "Reject",
      answering: "Sending decision",
      pause: "Pause",
      continue: "Continue",
      cancel: "Cancel",
      pausePending: "Pausing",
      continuePending: "Continuing",
      cancelPending: "Cancelling",
      cancelConfirmTitle: "Cancel this run?",
      cancelConfirmBody:
        "Cancelling cannot be undone. The current step stops and the run is marked cancelled.",
      cancelConfirm: "Yes, cancel run",
      keepRunning: "Keep running",
      streamHint:
        "Events arrive over a local server-sent event stream. Reconnecting replaces the state from the latest snapshot.",
      reloadStream: "Reload run and stream",
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
    primary: "اصلی",
    projects: "پروژه‌ها",
    workflows: "گردش‌کارها",
    runs: "اجراها",
    settings: "تنظیمات",
  },
  common: {
    refresh: "به‌روزرسانی",
    retry: "تلاش دوباره",
    loading: "در حال بارگذاری",
    save: "ذخیره",
    saving: "در حال ذخیره",
    cancel: "انصراف",
    back: "بازگشت",
    none: "هیچ‌کدام",
    unknown: "نامشخص",
    notAvailable: "در دسترس نیست",
    required: "لازم است",
    optional: "اختیاری",
    noItems: "هنوز چیزی برای نمایش نیست.",
  },
  statuses: {
    run: {
      pending: "در انتظار",
      running: "در حال اجرا",
      paused: "متوقف‌شده",
      waiting_approval: "در انتظار تأیید",
      completed: "کامل‌شده",
      failed: "ناموفق",
      cancelled: "لغوشده",
      interrupted: "قطع‌شده",
    },
    step: {
      pending: "در انتظار",
      running: "در حال اجرا",
      completed: "کامل‌شده",
      failed: "ناموفق",
      cancelled: "لغوشده",
    },
    approval: {
      pending: "در انتظار",
      approved: "تأییدشده",
      rejected: "ردشده",
      cancelled: "لغوشده",
    },
    stream: {
      connecting: "در حال اتصال به رویدادهای زنده",
      live: "رویدادهای زنده متصل است",
      reconnecting: "اتصال زنده قطع شد. در حال اتصال دوباره.",
      ended: "اجرا تمام شد؛ رویدادهای زنده بسته شد",
    },
  },
  historyKinds: {
    run_started: "اجرا شروع شد",
    run_paused: "اجرا متوقف شد",
    run_continued: "اجرا ادامه یافت",
    run_cancelled: "اجرا لغو شد",
    run_completed: "اجرا کامل شد",
    run_failed: "اجرا ناموفق شد",
    run_interrupted: "اجرا قطع شد",
    step_started: "مرحله شروع شد",
    step_attempt_failed: "تلاش مرحله ناموفق بود",
    step_completed: "مرحله کامل شد",
    step_failed: "مرحله ناموفق شد",
    step_cancelled: "مرحله لغو شد",
    session_close_failed: "بستن نشست ناموفق بود",
    containment_refused: "مرحله خارج از workspace رد شد",
    approval_requested: "درخواست تأیید ثبت شد",
    approval_approved: "تأیید شد",
    approval_rejected: "رد شد",
    approval_cancelled: "تأیید لغو شد",
  },
  runErrors: {
    invalid_request: "بعضی فیلدها معتبر نیستند.",
    invalid_json: "بدنهٔ درخواست خوانده نشد.",
    unsupported_media_type: "درخواست به‌صورت JSON ارسال نشد.",
    project_not_found: "آن پروژه دیگر وجود ندارد.",
    workflow_version_not_found: "آن نسخهٔ گردش‌کار دیگر وجود ندارد.",
    skill_version_not_found: "یکی از نسخه‌های Skill انتخاب‌شده دیگر وجود ندارد.",
    workspace_root_invalid:
      "پوشهٔ workspace قابل استفاده نیست. یک پوشهٔ موجود انتخاب کن.",
    workspace_root_registered:
      "این workspace از قبل به‌عنوان پروژه ثبت شده است.",
    runtime_profile_not_found: "آن پروفایل Runtime دیگر وجود ندارد.",
    runtime_profile_required:
      "این پروژه پروفایل Runtime پیش‌فرض ندارد. آن را در پروژه‌ها تنظیم کن.",
    runtime_profile_invalid:
      "پروفایل Runtime این پروژه معتبر نیست. آن را در تنظیمات بررسی کن.",
    credential_missing:
      "برای پروفایل Runtime هیچ کلید API ذخیره نشده است. آن را در تنظیمات تنظیم کن.",
    workflow_version_not_selected:
      "آن نسخهٔ گردش‌کار برای این پروژه انتخاب نشده است.",
    workflow_version_invalid: "نسخهٔ گردش‌کار قابل اجرا نیست.",
    skill_version_missing:
      "نسخهٔ Skill موردنیاز این گردش‌کار موجود نیست.",
    run_not_found: "آن اجرا دیگر وجود ندارد.",
    run_busy: "یک اجرای دیگر فعال است. تا پایان آن صبر کن.",
    run_state_conflict: "وضعیت اجرا تغییر کرد. صفحه را دوباره بارگذاری کن.",
    approval_not_found: "آن درخواست تأیید دیگر وجود ندارد.",
    approval_already_resolved: "به آن درخواست تأیید قبلاً پاسخ داده شده است.",
    persistence_error: "مخزن گردش‌کار در دسترس نیست.",
    runtime_unavailable: "Runtime مربوط به Reasonix شروع نشد.",
    network: "سرویس محلی در دسترس نبود.",
    unexpected: "درخواست به‌طور غیرمنتظره شکست خورد.",
  },
  projects: {
    title: "پروژه‌ها",
    intro:
      "workspaceها را ثبت کن و نسخه‌های گردش‌کار و Skill مورد استفادهٔ آن‌ها را مشخص کن.",
    listTitle: "پروژه‌های ثبت‌شده",
    emptyTitle: "هنوز پروژه‌ای نیست",
    emptyBody:
      "یک workspace را در پایین ثبت کن، نسخه‌های گردش‌کارش را انتخاب کن و یک پروفایل Runtime پیش‌فرض بده تا بتواند اجرا شروع کند.",
    registerTitle: "ثبت پروژه",
    registerIntro:
      "پوشهٔ workspace باید از قبل روی این سیستم وجود داشته باشد. Domino مسیر canonical آن را ذخیره می‌کند.",
    fields: {
      name: "نام پروژه",
      nameHelp: "یک نام محلی برای این workspace.",
      workspaceRoot: "ریشهٔ workspace",
      workspaceRootHelp: "مسیر مطلق پوشهٔ موجود پروژه.",
      defaultProfile: "پروفایل Runtime پیش‌فرض",
      defaultProfileHelp:
        "اجراها از این پروفایل استفاده می‌کنند. بعداً می‌توانی آن را از فهرست پروژه‌ها تغییر بدهی.",
      workflowVersions: "نسخه‌های گردش‌کار",
      workflowVersionsHelp:
        "حداقل یک نسخهٔ منتشرشده انتخاب کن. فقط همین نسخه‌ها در این پروژه اجرا می‌شوند.",
      skillVersions: "نسخه‌های Skill",
      skillVersionsHelp: "انتخاب‌های اختیاری که با پروژه ثبت می‌شوند.",
      nameRequired: "نام پروژه را وارد کن.",
      workspaceRootRequired: "پوشهٔ موجود workspace را وارد کن.",
      workflowVersionsRequired: "حداقل یک نسخهٔ گردش‌کار انتخاب کن.",
      defaultProfileRequired: "یک پروفایل Runtime در دسترس انتخاب کن.",
      skillVersionsRequired: "نسخه‌های Skill در دسترس را انتخاب کن.",
    },
    options: {
      noProfile: "بدون پروفایل پیش‌فرض",
    },
    actions: {
      register: "ثبت پروژه",
      registering: "در حال ثبت",
      saveProfile: "ذخیرهٔ پروفایل",
      savingProfile: "در حال ذخیرهٔ پروفایل",
    },
    lists: {
      workflowVersions: "نسخه‌های گردش‌کار",
      skillVersions: "نسخه‌های Skill",
      registeredAt: "تاریخ ثبت",
      noSkills: "هیچ نسخهٔ Skill انتخاب نشده است.",
    },
    feedback: {
      created: "پروژه ثبت شد.",
      profileUpdated: "پروفایل Runtime پیش‌فرض به‌روزرسانی شد.",
    },
    notices: {
      noWorkflows:
        "هیچ نسخهٔ منتشرشدهٔ گردش‌کار موجود نیست. پیش از ثبت پروژه یک نسخه منتشر کن.",
      noProfiles:
        "هنوز پروفایل Runtime وجود ندارد. پیش از شروع اجرا یکی در تنظیمات بساز.",
      noSkillVersions: "هیچ نسخهٔ منتشرشدهٔ Skill موجود نیست.",
    },
  },
  workflows: {
    title: "گردش‌کارها",
    intro:
      "تعاریف منتشرشدهٔ گردش‌کار و نسخه‌های آن‌ها. این صفحه فقط‌خواندنی است.",
    emptyTitle: "هیچ گردش‌کاری منتشر نشده است",
    emptyBody:
      "هنوز تعریف گردش‌کاری وجود ندارد. انتشار از داشبورد در دسترس نیست.",
    latestBadge: "آخرین",
    definitionsTitle: "گردش‌کارهای منتشرشده",
    versionsTitle: "نسخه‌ها",
    versionLabel: "نسخه",
    stepsTitle: "مراحل",
    approvalPointsTitle: "نقاط تأیید",
    noApprovalPoints: "هیچ نقطهٔ تأییدی نیست.",
    skillVersionsTitle: "نسخه‌های Skill",
    noSkillVersions: "هیچ نسخهٔ Skillی نیست.",
    lastRunTitle: "آخرین اجرا",
    noRuns: "هنوز اجرایی نیست.",
    publishedAt: "تاریخ انتشار",
    noVersions: "هیچ نسخهٔ منتشرشده‌ای نیست.",
    stepLabel: "مرحله",
  },
  runs: {
    title: "اجراها",
    intro:
      "یک گردش‌کار را روی پروژهٔ ثبت‌شده شروع کن و وضعیت زندهٔ آن را ببین.",
    listTitle: "تاریخچهٔ اجرا",
    emptyTitle: "هنوز اجرایی نیست",
    emptyBody:
      "یک گردش‌کار را در پایین شروع کن. این فهرست وضعیت و تاریخچهٔ اجرا را نگه می‌دارد.",
    startTitle: "شروع اجرا",
    startIntro:
      "یک پروژهٔ ثبت‌شده و یکی از نسخه‌های گردش‌کار انتخاب‌شدهٔ آن را انتخاب کن.",
    fields: {
      project: "پروژه",
      workflowVersion: "نسخهٔ گردش‌کار",
      projectHelp: "فقط پروژه‌های ثبت‌شده اینجا نمایش داده می‌شوند.",
      workflowVersionHelp:
        "فقط نسخه‌هایی که برای آن پروژه انتخاب شده‌اند اجرا می‌شوند.",
      projectRequired: "یک پروژه انتخاب کن.",
      workflowVersionRequired: "یک نسخهٔ گردش‌کار انتخاب کن.",
    },
    actions: {
      start: "شروع اجرا",
      starting: "در حال شروع",
      open: "باز کردن اجرا",
      reload: "بارگذاری دوبارهٔ اجرا",
    },
    list: {
      project: "پروژه",
      workflow: "گردش‌کار",
      status: "وضعیت",
      created: "تاریخ ایجاد",
      duration: "مدت",
      actions: "عملیات",
      unknownProject: "پروژهٔ نامشخص",
    },
    notices: {
      noProjects: "پیش از شروع اجرا یک پروژه ثبت کن.",
      noVersions: "این پروژه هیچ نسخهٔ گردش‌کار انتخاب‌شده‌ای ندارد.",
      noProfile:
        "این پروژه پروفایل Runtime پیش‌فرض ندارد. آن را در پروژه‌ها تنظیم کن.",
    },
    detail: {
      runId: "شناسهٔ اجرا",
      project: "پروژه",
      workflow: "گردش‌کار",
      workspace: "workspace",
      status: "وضعیت",
      created: "تاریخ ایجاد",
      started: "شروع",
      finished: "پایان",
      elapsed: "زمان سپری‌شده",
      stepsTitle: "مراحل",
      approvalsTitle: "تأییدها",
      controlsTitle: "کنترل اجرا",
      eventsTitle: "رویدادهای زنده",
      historyTitle: "تاریخچه",
      noSteps: "هنوز مرحله‌ای ثبت نشده است.",
      noApprovals: "هیچ درخواست تأییدی ثبت نشده است.",
      noEvents: "هنوز رویداد Runtimeی نیست.",
      noHistory: "هنوز تاریخچه‌ای نیست.",
      result: "نتیجه",
      error: "خطا",
      attempts: "تلاش‌ها",
      stepLabel: "مرحله",
      approve: "تأیید",
      reject: "رد",
      answering: "در حال ارسال تصمیم",
      pause: "توقف",
      continue: "ادامه",
      cancel: "لغو",
      pausePending: "در حال توقف",
      continuePending: "در حال ادامه",
      cancelPending: "در حال لغو",
      cancelConfirmTitle: "این اجرا لغو شود؟",
      cancelConfirmBody:
        "لغو قابل بازگشت نیست. مرحلهٔ فعلی متوقف می‌شود و اجرا لغوشده علامت می‌خورد.",
      cancelConfirm: "بله، اجرا لغو شود",
      keepRunning: "ادامهٔ اجرا",
      streamHint:
        "رویدادها از طریق جریان رویداد محلی سرور می‌رسند. اتصال دوباره وضعیت را از آخرین snapshot جایگزین می‌کند.",
      reloadStream: "بارگذاری دوبارهٔ اجرا و جریان",
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
