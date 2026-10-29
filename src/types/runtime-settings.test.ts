import { describe, expect, expectTypeOf, it } from "vitest";
import {
  isRuntimeProfile,
  validateCredentialRef,
  validateRuntimeProfile,
  type CredentialRef,
  type CredentialStatus,
  type CredentialStore,
  type RuntimeProfile,
} from "./runtime-settings";

const BASE_PROFILE: RuntimeProfile = {
  id: "profile-1",
  label: "Reasonix default",
  adapterId: "reasonix",
  providerName: "deepseek",
  model: "deepseek/deepseek-flash",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  credentialRef: {
    kind: "reasonix-env",
    providerName: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
};

const SECRET_LIKE_FIELDS = [
  "apiKey",
  "secret",
  "token",
  "password",
  "credentials",
];

function hasField(value: unknown, field: string): boolean {
  return validateRuntimeProfile(value).some((error) => error.field === field);
}

function hasCredentialField(value: unknown, field: string): boolean {
  return validateCredentialRef(value).some((error) => error.field === field);
}

function createStore(): CredentialStore {
  return {
    async status(): Promise<CredentialStatus> {
      return "missing";
    },
    async set(): Promise<void> {},
    async remove(): Promise<void> {},
  };
}

describe("RuntimeProfile contract", () => {
  it("accepts a valid non-secret profile", () => {
    expect(validateRuntimeProfile(BASE_PROFILE)).toEqual([]);
    expect(isRuntimeProfile(BASE_PROFILE)).toBe(true);
  });

  it("has only metadata keys", () => {
    expectTypeOf<keyof RuntimeProfile>().toEqualTypeOf<
      | "id"
      | "label"
      | "adapterId"
      | "providerName"
      | "model"
      | "apiKeyEnv"
      | "credentialRef"
      | "createdAt"
      | "updatedAt"
    >();
    expectTypeOf<
      "apiKey" extends keyof RuntimeProfile ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "secret" extends keyof RuntimeProfile ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "token" extends keyof RuntimeProfile ? true : false
    >().toEqualTypeOf<false>();
  });

  it("rejects secret-like top-level fields", () => {
    for (const field of SECRET_LIKE_FIELDS) {
      expect(
        hasField({ ...BASE_PROFILE, [field]: "should-not-be-here" }, field),
      ).toBe(true);
    }
  });

  it("rejects secret-like fields inside credentialRef", () => {
    expect(
      hasField(
        {
          ...BASE_PROFILE,
          credentialRef: {
            ...BASE_PROFILE.credentialRef,
            secret: "should-not-be-here",
          },
        },
        "credentialRef.secret",
      ),
    ).toBe(true);
  });

  it("rejects a credentialRef that does not match the profile", () => {
    expect(
      hasField(
        {
          ...BASE_PROFILE,
          credentialRef: {
            ...BASE_PROFILE.credentialRef,
            providerName: "other-provider",
          },
        },
        "credentialRef.providerName",
      ),
    ).toBe(true);
    expect(
      hasField(
        {
          ...BASE_PROFILE,
          credentialRef: {
            ...BASE_PROFILE.credentialRef,
            apiKeyEnv: "OTHER_KEY",
          },
        },
        "credentialRef.apiKeyEnv",
      ),
    ).toBe(true);
  });

  it("rejects an unsupported adapter", () => {
    expect(hasField({ ...BASE_PROFILE, adapterId: "other" }, "adapterId")).toBe(
      true,
    );
  });

  it("rejects an invalid apiKeyEnv name", () => {
    expect(
      hasField({ ...BASE_PROFILE, apiKeyEnv: "not a variable" }, "apiKeyEnv"),
    ).toBe(true);
  });

  it("rejects empty required strings", () => {
    for (const field of ["id", "label", "providerName", "model"]) {
      expect(hasField({ ...BASE_PROFILE, [field]: "" }, field)).toBe(true);
    }
  });

  it("rejects invalid timestamps", () => {
    for (const field of ["createdAt", "updatedAt"]) {
      expect(hasField({ ...BASE_PROFILE, [field]: "not-a-date" }, field)).toBe(
        true,
      );
    }
  });

  it("rejects non-object values", () => {
    for (const value of [null, [], "profile", 1]) {
      expect(validateRuntimeProfile(value)).not.toEqual([]);
      expect(isRuntimeProfile(value)).toBe(false);
    }
  });

  it("rejects a profile without a credentialRef", () => {
    expect(hasField({ ...BASE_PROFILE, credentialRef: undefined }, "credentialRef")).toBe(
      true,
    );
  });
});

describe("CredentialRef contract", () => {
  it("accepts a valid reference", () => {
    expect(validateCredentialRef(BASE_PROFILE.credentialRef)).toEqual([]);
  });

  it("has only metadata keys", () => {
    expectTypeOf<keyof CredentialRef>().toEqualTypeOf<
      "kind" | "providerName" | "apiKeyEnv"
    >();
    expectTypeOf<
      "secret" extends keyof CredentialRef ? true : false
    >().toEqualTypeOf<false>();
  });

  it("rejects extra fields, including secret-like fields", () => {
    expect(
      hasCredentialField(
        { ...BASE_PROFILE.credentialRef, token: "should-not-be-here" },
        "credentialRef.token",
      ),
    ).toBe(true);
  });

  it("rejects an unsupported kind", () => {
    expect(
      hasCredentialField(
        { ...BASE_PROFILE.credentialRef, kind: "other" },
        "credentialRef.kind",
      ),
    ).toBe(true);
  });

  it("rejects an invalid environment variable name", () => {
    expect(
      hasCredentialField(
        { ...BASE_PROFILE.credentialRef, apiKeyEnv: "not a variable" },
        "credentialRef.apiKeyEnv",
      ),
    ).toBe(true);
  });

  it("rejects non-object values", () => {
    for (const value of [null, [], "ref", 1]) {
      expect(validateCredentialRef(value)).not.toEqual([]);
    }
  });
});

describe("CredentialStore contract", () => {
  it("exposes only status, set, and remove at runtime", () => {
    const store = createStore();

    expect(Object.keys(store).sort()).toEqual(["remove", "set", "status"]);
    expect((store as unknown as Record<string, unknown>).get).toBeUndefined();
    expect(
      (store as unknown as Record<string, unknown>).read,
    ).toBeUndefined();
  });

  it("has no readback operation in its type", () => {
    expectTypeOf<keyof CredentialStore>().toEqualTypeOf<
      "status" | "set" | "remove"
    >();
    expectTypeOf<
      "get" extends keyof CredentialStore ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "read" extends keyof CredentialStore ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      Awaited<ReturnType<CredentialStore["status"]>>
    >().toEqualTypeOf<CredentialStatus>();
    expectTypeOf<ReturnType<CredentialStore["set"]>>().toEqualTypeOf<
      Promise<void>
    >();
    expectTypeOf<ReturnType<CredentialStore["remove"]>>().toEqualTypeOf<
      Promise<void>
    >();
  });
});
