import type { Database } from "../infrastructure/db/client.js";
import type { Auth } from "../infrastructure/auth/auth.js";
import { reply } from "../accounts/http.js";
import { decodeHandle } from "../http/path.js";
import { memberAPI, uuid } from "../http/member-api.js";
import type { Friends } from "./service.js";
export function friendsHTTP(
  request: Request,
  db: Database,
  auth: Auth,
  service: Friends,
): Promise<Response | null> {
  return memberAPI(
    request,
    db,
    auth,
    {
      owns: (path) =>
        path.startsWith("/api/v1/me/friends") || path === "/api/v1/people",
      methods: ["GET", "POST"],
      access: "group",
    },
    async ({ identity: i, url, path, method }) => {
      const target = path.match(/^\/api\/v1\/me\/friends\/requests\/([^/]+)$/);
      const operation = path.match(
        /^\/api\/v1\/me\/friends\/([a-f0-9-]+)\/(accept|refuse|cancel|remove)$/,
      );
      if (path === "/api/v1/people" && method === "GET")
        return reply(
          await service.search(
            i,
            url.searchParams.get("q") ?? "",
            url.searchParams.get("after") ?? "",
          ),
        );
      if (path === "/api/v1/me/friends" && method === "GET")
        return reply(
          await service.list(
            i,
            url.searchParams.get("kind") ?? "friends",
            url.searchParams.get("after") ?? "",
          ),
        );
      if (target && method === "POST") {
        const handle = decodeHandle(target[1]);
        if (!handle) return reply({ code: "invalid_request" }, 400);
        return reply(await service.request(i, handle));
      }
      if (operation && uuid(operation[1]) && method === "POST")
        return reply(await service.act(i, operation[1], operation[2]));
      return reply({ code: "not_found" }, 404);
    },
  );
}
