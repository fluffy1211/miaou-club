import type { Database } from "../infrastructure/db/client.js";
import type { Auth } from "../infrastructure/auth/auth.js";
import { identity } from "../accounts/security.js";
import { reply } from "../accounts/http.js";
import { EncounterError, uuid } from "../encounters/service.js";
import { DataManagement } from "./service.js";
async function dataHTTPInternal(
  request: Request,
  db: Database,
  auth: Auth,
  service: DataManagement,
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname;
  if (
    !path.startsWith("/api/v1/admin/reports") &&
    !path.startsWith("/api/v1/admin/members") &&
    path !== "/api/v1/admin/audit" &&
    !path.startsWith("/api/v1/me/export") &&
    path !== "/api/v1/me/deletion" &&
    !/^\/api\/v1\/encounters\/[^/]+\/report$/.test(path)
  )
    return null;
  try {
    if (!["GET", "POST"].includes(request.method))
      return reply({ code: "method_not_allowed" }, 405);
    const i = await identity(db, auth, request.headers);
    if (!i) return reply({ code: "unauthenticated" }, 401);
    if (!i.policy || i.policy.status === "deleting")
      return reply({ code: "forbidden" }, 403);
    if (
      request.method === "POST" &&
      request.headers.get("origin") !==
        new URL((await auth.$context).baseURL).origin
    )
      return reply({ code: "forbidden" }, 403);
    let body: Record<string, unknown> = {};
    if (request.method === "POST") {
      const reader = request.body?.getReader();
      if (!reader) throw new EncounterError("invalid_request");
      const parts: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8192) {
          await reader.cancel();
          throw new EncounterError("invalid_request", 413);
        }
        parts.push(value);
      }
      try {
        body = JSON.parse(Buffer.concat(parts).toString());
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error();
      } catch {
        throw new EncounterError("invalid_request");
      }
    }
    const report = path.match(/^\/api\/v1\/encounters\/([^/]+)\/report$/),
      admin = path.match(
        /^\/api\/v1\/admin\/reports\/([^/]+)\/(consult|image|action)$/,
      ),
      member = path.match(/^\/api\/v1\/admin\/members\/([^/]+)$/),
      download = path.match(/^\/api\/v1\/me\/exports\/([^/]+)\/download$/);
    if (report && uuid(report[1]) && request.method === "POST")
      return reply(await service.report(i, report[1], body.reason), 201);
    if (path === "/api/v1/admin/reports" && request.method === "GET") {
      const rows = await service.reports(
        i,
        url.searchParams.get("after") ?? undefined,
      );
      return reply({
        reports: rows.slice(0, 50),
        next: rows.length > 50 ? rows[49].id : null,
      });
    }
    if (admin && uuid(admin[1])) {
      if (admin[2] === "consult" && request.method === "POST")
        return reply({
          encounter: await service.consult(i, admin[1], body.reason),
        });
      if (admin[2] === "action" && request.method === "POST")
        return reply(
          await service.moderate(i, admin[1], body.action, body.reason),
        );
      if (admin[2] === "image" && request.method === "GET") {
        const grant = url.searchParams.get("consultation");
        if (!uuid(grant)) return reply({ code: "not_found" }, 404);
        return new Response(
          new Uint8Array(await service.image(i, admin[1], grant)),
          {
            headers: {
              "content-type": "image/webp",
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          },
        );
      }
    }
    if (path === "/api/v1/admin/members" && request.method === "GET")
      return reply({ members: await service.members(i) });
    if (member && member[1].length <= 128 && request.method === "POST")
      return reply(
        await service.suspend(i, member[1], body.action, body.reason),
      );
    if (path === "/api/v1/admin/audit" && request.method === "GET") {
      const rows = await service.history(
        i,
        url.searchParams.get("after") ?? undefined,
      );
      return reply({
        audit: rows.slice(0, 50),
        next: rows.length > 50 ? rows[49].id : null,
      });
    }
    if (path === "/api/v1/me/export" && request.method === "POST")
      return reply({ export: await service.requestExport(i) }, 202);
    if (path === "/api/v1/me/exports" && request.method === "GET")
      return reply({ exports: await service.exports(i) });
    if (download && uuid(download[1]) && request.method === "GET")
      return new Response(
        new Uint8Array(await service.download(i, download[1])),
        {
          headers: {
            "content-type": "application/zip",
            "content-disposition": 'attachment; filename="miaou-donnees.zip"',
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        },
      );
    if (path === "/api/v1/me/deletion" && request.method === "POST")
      return reply(await service.deletion(i, body.confirmation), 202);
    return reply({ code: "not_found" }, 404);
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

export async function dataHTTP(
  request: Request,
  db: Database,
  auth: Auth,
  service: DataManagement,
) {
  const response = await dataHTTPInternal(request, db, auth, service);
  if (response && response.status !== 401) {
    const refreshed = await auth.api.getSession({
      headers: request.headers,
      asResponse: true,
    });
    for (const cookie of refreshed.headers.getSetCookie())
      response.headers.append("set-cookie", cookie);
  }
  return response;
}
