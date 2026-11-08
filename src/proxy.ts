import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, localeCookieName } from "./i18n/config";
import { evaluateRequest } from "./lib/safety/origin";

const oneYearInSeconds = 60 * 60 * 24 * 365;

const ORIGIN_REJECTED = {
  error: {
    code: "origin_not_allowed",
    message: "Cross-origin request rejected.",
  },
} as const;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const decision = evaluateRequest({
      method: request.method,
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      requestOrigin: request.nextUrl.origin,
    });

    if (!decision.allowed) {
      return NextResponse.json(ORIGIN_REJECTED, { status: 403 });
    }

    return NextResponse.next();
  }

  const [firstSegment] = pathname.split("/").filter(Boolean);
  const saved = request.cookies.get(localeCookieName)?.value;
  const preferred = isLocale(saved) ? saved : defaultLocale;

  if (isLocale(firstSegment)) {
    const response = NextResponse.next();

    if (saved !== firstSegment) {
      response.cookies.set(localeCookieName, firstSegment, {
        path: "/",
        maxAge: oneYearInSeconds,
        sameSite: "lax",
      });
    }

    return response;
  }

  const url = request.nextUrl.clone();
  url.pathname =
    pathname === "/" ? `/${preferred}` : `/${preferred}${pathname}`;

  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};
