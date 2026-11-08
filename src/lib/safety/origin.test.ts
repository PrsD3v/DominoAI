import { describe, expect, it } from "vitest";
import {
  evaluateRequest,
  hostnameFromHostHeader,
  isLoopbackHostname,
  isStateChangingMethod,
} from "./origin";

describe("host and origin guard", () => {
  it("allows a same-origin mutation on a loopback host", () => {
    expect(
      evaluateRequest({
        method: "POST",
        host: "localhost:3000",
        origin: "http://localhost:3000",
        requestOrigin: "http://localhost:3000",
      }),
    ).toEqual({ allowed: true });
  });

  it("allows a same-origin mutation using the numeric loopback address", () => {
    expect(
      evaluateRequest({
        method: "PATCH",
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        requestOrigin: "http://127.0.0.1:3000",
      }),
    ).toEqual({ allowed: true });
  });

  it("allows a same-origin mutation over bracketed IPv6", () => {
    expect(
      evaluateRequest({
        method: "DELETE",
        host: "[::1]:3000",
        origin: "http://[::1]:3000",
        requestOrigin: "http://[::1]:3000",
      }),
    ).toEqual({ allowed: true });
  });

  it("rejects a mutation from another origin", () => {
    expect(
      evaluateRequest({
        method: "POST",
        host: "localhost:3000",
        origin: "http://evil.test",
        requestOrigin: "http://localhost:3000",
      }),
    ).toEqual({ allowed: false, reason: "origin_not_allowed" });
  });

  it("rejects a mutation whose loopback origin uses another port", () => {
    expect(
      evaluateRequest({
        method: "POST",
        host: "localhost:3000",
        origin: "http://localhost:4000",
        requestOrigin: "http://localhost:3000",
      }),
    ).toEqual({ allowed: false, reason: "origin_not_allowed" });
  });

  it("rejects an unparseable origin", () => {
    expect(
      evaluateRequest({
        method: "POST",
        host: "localhost:3000",
        origin: "not a url",
        requestOrigin: "http://localhost:3000",
      }),
    ).toEqual({ allowed: false, reason: "origin_not_allowed" });
  });

  it("rejects a non-http origin", () => {
    expect(
      evaluateRequest({
        method: "POST",
        host: "localhost:3000",
        origin: "file://localhost/tmp",
        requestOrigin: "http://localhost:3000",
      }),
    ).toEqual({ allowed: false, reason: "origin_not_allowed" });
  });

  it("allows a mutation with no Origin for non-browser clients", () => {
    expect(
      evaluateRequest({
        method: "POST",
        host: "localhost:3000",
        requestOrigin: "http://localhost:3000",
      }),
    ).toEqual({ allowed: true });
  });

  it("rejects cross-site fetch metadata even without Origin", () => {
    expect(
      evaluateRequest({
        method: "POST",
        host: "localhost:3000",
        secFetchSite: "cross-site",
        requestOrigin: "http://localhost:3000",
      }),
    ).toEqual({ allowed: false, reason: "origin_not_allowed" });
  });

  it("rejects any API request with a non-loopback Host", () => {
    expect(
      evaluateRequest({
        method: "GET",
        host: "evil.test:3000",
        requestOrigin: "http://evil.test:3000",
      }),
    ).toEqual({ allowed: false, reason: "host_not_loopback" });
  });

  it("does not apply the origin rule to safe methods", () => {
    expect(
      evaluateRequest({
        method: "GET",
        host: "localhost:3000",
        origin: "http://evil.test",
        requestOrigin: "http://localhost:3000",
      }),
    ).toEqual({ allowed: true });
  });

  it("does not apply the origin rule to HEAD or OPTIONS", () => {
    for (const method of ["HEAD", "OPTIONS"]) {
      expect(
        evaluateRequest({
          method,
          host: "localhost:3000",
          origin: "http://evil.test",
          secFetchSite: "cross-site",
          requestOrigin: "http://localhost:3000",
        }),
      ).toEqual({ allowed: true });
    }
  });
});

describe("host parsing", () => {
  it("strips a port and normalizes case", () => {
    expect(hostnameFromHostHeader("LOCALHOST:3000")).toBe("localhost");
    expect(hostnameFromHostHeader("127.0.0.1:8080")).toBe("127.0.0.1");
  });

  it("strips brackets from IPv6 hosts", () => {
    expect(hostnameFromHostHeader("[::1]:3000")).toBe("::1");
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("returns null for an empty or malformed host", () => {
    expect(hostnameFromHostHeader("")).toBeNull();
    expect(hostnameFromHostHeader("[::1")).toBeNull();
    expect(hostnameFromHostHeader(":3000")).toBeNull();
  });

  it("recognizes only loopback hostnames", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("localhost.evil.test")).toBe(false);
    expect(isLoopbackHostname("127.0.0.2")).toBe(false);
  });

  it("treats only mutating methods as state-changing", () => {
    expect(isStateChangingMethod("post")).toBe(true);
    expect(isStateChangingMethod("PUT")).toBe(true);
    expect(isStateChangingMethod("get")).toBe(false);
    expect(isStateChangingMethod("HEAD")).toBe(false);
  });
});
