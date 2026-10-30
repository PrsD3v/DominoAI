"use client";

import { useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requestSettingsJson } from "@/lib/settings/client";
import {
  narrowConnectionTestResponse,
  type SettingsFailureCode,
} from "@/lib/settings/screen";
import { useI18n } from "@/i18n/provider";
import type {
  ConnectionTestFailureCode,
  RuntimeProfile,
} from "@/types/runtime-settings";

type TestState =
  | { readonly status: "idle" }
  | { readonly status: "testing" }
  | { readonly status: "succeeded" }
  | { readonly status: "failed"; readonly code: ConnectionTestFailureCode }
  | { readonly status: "request_failed"; readonly code: SettingsFailureCode };

export interface ConnectionTestButtonProps {
  readonly profile: RuntimeProfile;
  readonly onProfileMissing?: () => void;
}

export function ConnectionTestButton({
  profile,
  onProfileMissing,
}: ConnectionTestButtonProps) {
  const { messages } = useI18n();
  const [state, setState] = useState<TestState>({ status: "idle" });
  const testing = state.status === "testing";

  async function run() {
    if (testing) {
      return;
    }

    setState({ status: "testing" });

    const result = await requestSettingsJson(
      `/api/settings/profiles/${profile.id}/connection-test`,
      { method: "POST" },
    );

    if (!result.ok) {
      setState({ status: "request_failed", code: result.code });

      if (result.code === "profile_not_found") {
        onProfileMissing?.();
      }

      return;
    }

    const narrowed = narrowConnectionTestResponse(result.body);

    if (narrowed === null) {
      setState({ status: "request_failed", code: "unexpected" });
      return;
    }

    setState(
      narrowed.outcome === "succeeded"
        ? { status: "succeeded" }
        : { status: "failed", code: narrowed.code },
    );
  }

  return (
    <div className="mt-2 flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={testing}
        aria-label={`${messages.settings.connection.test}: ${profile.label}`}
      >
        {testing
          ? messages.settings.connection.testing
          : messages.settings.connection.test}
      </Button>

      <div aria-live="polite" className="max-w-md">
        {state.status === "succeeded" ? (
          <Alert role="status">
            <AlertTitle>
              {messages.settings.connection.succeeded}
            </AlertTitle>
          </Alert>
        ) : null}

        {state.status === "failed" ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{messages.settings.connection.failed}</AlertTitle>
            <AlertDescription>
              {messages.settings.connection.errors[state.code]}
            </AlertDescription>
          </Alert>
        ) : null}

        {state.status === "request_failed" ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{messages.settings.errors[state.code]}</AlertTitle>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
