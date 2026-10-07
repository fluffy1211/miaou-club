import type { Database } from "../infrastructure/db/client.js";
import type { Auth } from "../infrastructure/auth/auth.js";
import { identity, groupAllowed } from "../accounts/security.js";
import { reply } from "../accounts/http.js";
import { EncounterError, uuid } from "../encounters/service.js";
import { decodeHandle } from "../http/path.js";
import type { Friends } from "./service.js";
export async function friendsHTTP(
  request: Request,
  db: Database,
  auth: Auth,
  service: Friends,
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname;
  if (!path.startsWith("/api/v1/me/friends") && path !== "/api/v1/people")
    return null;
  try {
    const i = await identity(db, auth, request.headers);
    if (!i) return reply({ code: "unauthenticated" }, 401);
    if (!groupAllowed(i)) return reply({ code: "forbidden" }, 403);
    if (!["GET", "POST"].includes(request.method))
      return reply({ code: "method_not_allowed" }, 405);
    if (
      request.method !== "GET" &&
      request.headers.get("origin") !==
        new URL((await auth.$context).baseURL).origin
    )
      return reply({ code: "forbidden" }, 403);
    const target = path.match(/^\/api\/v1\/me\/friends\/requests\/([^/]+)$/);
    const operation = path.match(
      /^\/api\/v1\/me\/friends\/([a-f0-9-]+)\/(accept|refuse|cancel|remove)$/,
    );
    let response: Response;
    if (path === "/api/v1/people" && request.method === "GET")
      response = reply(
        await service.search(
          i,
          url.searchParams.get("q") ?? "",
          url.searchParams.get("after") ?? "",
        ),
      );
    else if (path === "/api/v1/me/friends" && request.method === "GET")
      response = reply(
        await service.list(
          i,
          url.searchParams.get("kind") ?? "friends",
          url.searchParams.get("after") ?? "",
        ),
      );
    else if (target && request.method === "POST") {
      const handle = decodeHandle(target[1]);
      if (!handle) return reply({ code: "invalid_request" }, 400);
      response = reply(await service.request(i, handle));
    } else if (operation && uuid(operation[1]) && request.method === "POST")
      response = reply(await service.act(i, operation[1], operation[2]));
    else return reply({ code: "not_found" }, 404);
    const refresh = await auth.api.getSession({
      headers: request.headers,
      asResponse: true,
    });
    for (const cookie of refresh.headers.getSetCookie())
      response.headers.append("set-cookie", cookie);
    return response;
  } catch (e) {
    if (e instanceof EncounterError)
      return reply(
        { code: e.code, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) },
        e.status,
        e.retryAfter ? { "retry-after": String(e.retryAfter) } : {},
      );
    return reply({ code: "unavailable" }, 503);
  }
}
