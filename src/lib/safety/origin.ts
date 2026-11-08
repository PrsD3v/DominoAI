/** Host and origin rules for Domino's local API surface. */

export const STATE_CHANGING_METHODS = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;

export type RequestRejectionReason =
  | "host_not_loopback"
  | "origin_not_allowed";

export type RequestGuardDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: RequestRejectionReason };

export interface RequestFacts {
  readonly method: string;
  /** The request's Host header. */
  readonly host?: string | null;
  /** The request's Origin header, when the client sent one. */
  readonly origin?: string | null;
  readonly secFetchSite?: string | null;
  /** The request's own absolute origin, for example `request.nextUrl.origin`. */
  readonly requestOrigin?: string | null;
}

const STATE_CHANGING = new Set<string>(STATE_CHANGING_METHODS);
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function allowed(): RequestGuardDecision {
  return { allowed: true };
}

function rejected(reason: RequestRejectionReason): RequestGuardDecision {
  return { allowed: false, reason };
}

export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING.has(method.trim().toUpperCase());
}

/** Extract the hostname from a Host header, including bracketed IPv6. */
export function hostnameFromHostHeader(host: string): string | null {
  const value = host.trim().toLowerCase();

  if (value === "") {
    return null;
  }

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 1 ? value.slice(1, end) : null;
  }

  const withoutPort = value.split(":")[0] ?? "";
  return withoutPort === "" ? null : withoutPort;
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  return LOOPBACK_HOSTNAMES.has(normalized);
}

export function isLoopbackHostHeader(host: string): boolean {
  const hostname = hostnameFromHostHeader(host);

  return hostname !== null && isLoopbackHostname(hostname);
}

/**
 * Decide whether a request may proceed. Every API request must carry a loopback
 * Host. State-changing requests additionally need a same-origin, loopback
 * Origin when the browser sent one. A missing Origin is allowed for non-browser
 * clients, but cross-site fetch metadata is always rejected.
 */
export function evaluateRequest(facts: RequestFacts): RequestGuardDecision {
  const host = facts.host?.trim() ?? "";

  if (host !== "" && !isLoopbackHostHeader(host)) {
    return rejected("host_not_loopback");
  }

  if (!isStateChangingMethod(facts.method)) {
    return allowed();
  }

  if ((facts.secFetchSite ?? "").trim().toLowerCase() === "cross-site") {
    return rejected("origin_not_allowed");
  }

  const origin = facts.origin?.trim() ?? "";

  if (origin === "") {
    return allowed();
  }

  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    return rejected("origin_not_allowed");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return rejected("origin_not_allowed");
  }

  if (!isLoopbackHostname(parsed.hostname)) {
    return rejected("origin_not_allowed");
  }

  const requestOrigin = facts.requestOrigin?.trim() ?? "";

  if (requestOrigin === "") {
    return rejected("origin_not_allowed");
  }

  let own: URL;

  try {
    own = new URL(requestOrigin);
  } catch {
    return rejected("origin_not_allowed");
  }

  return parsed.origin === own.origin
    ? allowed()
    : rejected("origin_not_allowed");
}
