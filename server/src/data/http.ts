import type { Database } from "../infrastructure/db/client.js";
import type { Auth } from "../infrastructure/auth/auth.js";
import { reply } from "../accounts/http.js";
import { memberAPI, uuid } from "../http/member-api.js";
import { DataManagement } from "./service.js";
export function dataHTTP(
  request: Request,
  db: Database,
  auth: Auth,
  service: DataManagement,
): Promise<Response | null> {
  return memberAPI(
    request,
    db,
    auth,
    {
      owns: (path) =>
        path.startsWith("/api/v1/admin/reports") ||
        path.startsWith("/api/v1/admin/members") ||
        path === "/api/v1/admin/audit" ||
        path.startsWith("/api/v1/me/export") ||
        path === "/api/v1/me/deletion" ||
        /^\/api\/v1\/encounters\/[^/]+\/report$/.test(path),
      methods: ["GET", "POST"],
      access: "member",
    },
    async (r) => {
      const { identity: i, url, path, method } = r;
      // Every mutation here carries a JSON object, even when a route ignores it.
      const body = method === "POST" ? await r.body() : {};
      const report = path.match(/^\/api\/v1\/encounters\/([^/]+)\/report$/),
        admin = path.match(
          /^\/api\/v1\/admin\/reports\/([^/]+)\/(consult|image|action)$/,
        ),
        member = path.match(/^\/api\/v1\/admin\/members\/([^/]+)$/),
        download = path.match(/^\/api\/v1\/me\/exports\/([^/]+)\/download$/);
      if (report && uuid(report[1]) && method === "POST")
        return reply(await service.report(i, report[1], body.reason), 201);
      if (path === "/api/v1/admin/reports" && method === "GET") {
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
        if (admin[2] === "consult" && method === "POST")
          return reply({
            encounter: await service.consult(i, admin[1], body.reason),
          });
        if (admin[2] === "action" && method === "POST")
          return reply(
            await service.moderate(i, admin[1], body.action, body.reason),
          );
        if (admin[2] === "image" && method === "GET") {
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
      if (path === "/api/v1/admin/members" && method === "GET")
        return reply({ members: await service.members(i) });
      if (member && member[1].length <= 128 && method === "POST")
        return reply(
          await service.suspend(i, member[1], body.action, body.reason),
        );
      if (path === "/api/v1/admin/audit" && method === "GET") {
        const rows = await service.history(
          i,
          url.searchParams.get("after") ?? undefined,
        );
        return reply({
          audit: rows.slice(0, 50),
          next: rows.length > 50 ? rows[49].id : null,
        });
      }
      if (path === "/api/v1/me/export" && method === "POST")
        return reply({ export: await service.requestExport(i) }, 202);
      if (path === "/api/v1/me/exports" && method === "GET")
        return reply({ exports: await service.exports(i) });
      if (download && uuid(download[1]) && method === "GET")
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
      if (path === "/api/v1/me/deletion" && method === "POST")
        return reply(await service.deletion(i, body.confirmation), 202);
      return reply({ code: "not_found" }, 404);
    },
  );
}
