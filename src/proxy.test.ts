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

  it("rejects a cross-origin API mutation", async () => {
    const response = proxy(
      new NextRequest("http://localhost/api/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://evil.test",
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "origin_not_allowed",
        message: "Cross-origin request rejected.",
      },
    });
  });

  it("allows a same-origin API mutation", () => {
    const response = proxy(
      new NextRequest("http://localhost/api/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "localhost",
          origin: "http://localhost",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not apply the origin rule to API reads", () => {
    const response = proxy(
      new NextRequest("http://localhost/api/runs", {
        headers: {
          host: "localhost",
          origin: "http://evil.test",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects API requests addressed to a non-loopback host", () => {
    const response = proxy(
      new NextRequest("http://evil.test/api/runs", {
        headers: { host: "evil.test" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
