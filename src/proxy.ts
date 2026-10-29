import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, localeCookieName } from "./i18n/config";

const oneYearInSeconds = 60 * 60 * 24 * 365;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
