import type { Database } from "../infrastructure/db/client.js";
import type { Auth } from "../infrastructure/auth/auth.js";
import { groupAllowed } from "../accounts/security.js";
import { reply } from "../accounts/http.js";
import type { Encounters } from "./service.js";
import { mainland } from "./mainland.js";
import { decodeHandle } from "../http/path.js";
import { memberAPI, uuid } from "../http/member-api.js";
export function encountersHTTP(
  request: Request,
  db: Database,
  auth: Auth,
  service: Encounters,
): Promise<Response | null> {
  return memberAPI(
    request,
    db,
    auth,
    {
      owns: (path) =>
        path.startsWith("/api/v1/media") ||
        path.startsWith("/api/v1/encounters") ||
        path === "/api/v1/me/encounters" ||
        path.startsWith("/api/v1/map") ||
        /^\/api\/v1\/profiles\/[^/]+\/encounters$/.test(path) ||
        path.startsWith("/media/"),
      methods: ["GET", "POST", "PATCH", "DELETE"],
      access: "member",
    },
    async ({ identity: i, request, url, path, method, body }) => {
      // Owners keep reading and deleting their own memories; publishing needs the club.
      if (method !== "GET" && method !== "DELETE" && !groupAllowed(i))
        return reply({ code: "forbidden" }, 403);
      let response: Response;
      const mediaImage = path.match(/^\/media\/([a-f0-9-]+)\/(image|thumb)$/);
      const media = path.match(/^\/api\/v1\/media\/([a-f0-9-]+)(\/retry)?$/);
      const encounter = path.match(/^\/api\/v1\/encounters\/([a-f0-9-]+)$/);
      if (mediaImage && uuid(mediaImage[1]) && method === "GET") {
        const bytes = await service.image(i, mediaImage[1], mediaImage[2]);
        response = new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": "image/webp",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      } else if (path === "/api/v1/media" && method === "POST")
        response = reply({ media: await service.upload(i, request) }, 201);
      else if (media && uuid(media[1]) && method === "GET" && !media[2])
        response = reply({ media: await service.media(i, media[1]) });
      else if (media && uuid(media[1]) && method === "POST" && media[2])
        response = reply({ media: await service.retry(i, media[1]) });
      else if (media && uuid(media[1]) && method === "DELETE" && !media[2]) {
        await service.abandon(i, media[1]);
        response = reply({ deleted: true });
      } else if (path === "/api/v1/me/encounters" && method === "GET")
        response = reply(
          await service.list(i, url.searchParams.get("after") ?? undefined),
        );
      else if (path === "/api/v1/map/contours" && method === "GET") {
        if (!groupAllowed(i)) return reply({ code: "forbidden" }, 403);
        response = reply({
          type: "FeatureCollection",
          license: "https://opendatacommons.org/licenses/odbl/1-0/",
          source: "https://www.data.gouv.fr/datasets/contours-administratifs",
          features: mainland.map((coordinates) => ({
            type: "Feature",
            properties: { source: "Etalab / IGN 2026", generalization: 100 },
            geometry: { type: "Polygon", coordinates },
          })),
        });
      } else if (
        (path === "/api/v1/encounters" ||
          path === "/api/v1/map" ||
          /^\/api\/v1\/profiles\/[^/]+\/encounters$/.test(path)) &&
        method === "GET"
      ) {
        const handle = path.startsWith("/api/v1/profiles/")
          ? decodeHandle(path.split("/")[4])
          : undefined;
        if (handle === null) return reply({ code: "invalid_request" }, 400);
        response = reply(
          await service.discover(i, {
            after: url.searchParams.get("after") ?? undefined,
            map: path === "/api/v1/map",
            handle,
          }),
        );
      } else if (path === "/api/v1/encounters" && method === "POST")
        response = reply(
          {
            encounter: await service.publish(
              i,
              await body(),
              request.headers.get("idempotency-key") ?? "",
            ),
          },
          201,
        );
      else if (encounter && uuid(encounter[1]) && method === "GET")
        response = reply({ encounter: await service.detail(i, encounter[1]) });
      else if (encounter && uuid(encounter[1]) && method === "PATCH")
        response = reply({
          encounter: await service.edit(i, encounter[1], await body()),
        });
      else if (encounter && uuid(encounter[1]) && method === "DELETE") {
        await service.remove(i, encounter[1]);
        response = reply({ deleted: true });
      } else return reply({ code: "not_found" }, 404);
      return response;
    },
  );
}
