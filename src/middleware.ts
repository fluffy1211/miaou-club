import { defineMiddleware } from "astro:middleware";
import { handleRequest } from "@miaou/server/http";

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname.replace(/\/$/, "") || "/";
  if (path.startsWith("/api/") || path === "/acces") return next();
  const response = await handleRequest(
    new Request(new URL("/api/v1/access", context.url), {
      headers: context.request.headers,
    }),
  );
  if (response.status !== 200) {
    const redirect = context.redirect(
      response.status === 503 ? "/acces?etat=indisponible" : "/acces",
      302,
    );
    redirect.headers.set("Cache-Control", "no-store");
    return redirect;
  }
  const page = await next();
  page.headers.set("Cache-Control", "no-store");
  return page;
});
