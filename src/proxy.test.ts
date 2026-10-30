import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { defaultLocale, localeCookieName } from "./i18n/config";
import { proxy } from "./proxy";

describe("locale proxy", () => {
  it("does not redirect API paths", () => {
    const response = proxy(
      new NextRequest("http://localhost/api/settings/providers"),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a locale-less page path to the default locale", () => {
    const response = proxy(new NextRequest("http://localhost/settings"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `http://localhost/${defaultLocale}/settings`,
    );
  });

  it("keeps a locale path and sets the locale cookie", () => {
    const response = proxy(new NextRequest("http://localhost/fa/settings"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get(localeCookieName)?.value).toBe("fa");
  });
});
