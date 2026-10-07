import { defineMiddleware } from "astro:middleware";
import { handleRequest } from "@miaou/server/http";

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname.replace(/\/$/, "") || "/";
  if (
    path.startsWith("/api/") ||
    path.startsWith("/media/") ||
    path === "/carnet" ||
    path.startsWith("/rencontre/") ||
    [
      "/acces",
      "/profil",
      "/donnees",
      "/compte",
      "/mot-de-passe-oublie",
      "/reinitialisation",
      "/conditions",
    ].includes(path)
  ) {
    const page = await next();
    page.headers.set("Cache-Control", "no-store");
    return page;
  }
  const response = await handleRequest(
    new Request(new URL("/api/v1/access", context.url), {
      headers: context.request.headers,
    }),
  );
  if (response.status !== 200) {
    const redirect = context.redirect(
      response.status === 503
        ? "/acces?etat=indisponible"
        : "/profil?retour=" + encodeURIComponent(path + context.url.search),
      302,
    );
    redirect.headers.set("Cache-Control", "no-store");
    return redirect;
  }
  const page = await next();
  page.headers.set("Cache-Control", "no-store");
  for (const cookie of response.headers.getSetCookie())
    page.headers.append("set-cookie", cookie);
  return page;
});
