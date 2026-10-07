import type { Database } from "../infrastructure/db/client.js";
import type { Auth } from "../infrastructure/auth/auth.js";
import { identity, groupAllowed } from "../accounts/security.js";
import { reply } from "../accounts/http.js";
import { Encounters, EncounterError, uuid } from "./service.js";
import { mainland } from "./mainland.js";
import { decodeHandle } from "../http/path.js";
async function jsonBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new EncounterError("invalid_request");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 8192) {
      await reader.cancel();
      throw new EncounterError("invalid_request", 413);
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new EncounterError("invalid_request");
  }
}
export async function encountersHTTP(
  request: Request,
  db: Database,
  auth: Auth,
  service: Encounters,
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname;
  if (
    !path.startsWith("/api/v1/media") &&
    !path.startsWith("/api/v1/encounters") &&
    path !== "/api/v1/me/encounters" &&
    !path.startsWith("/api/v1/map") &&
    !/^\/api\/v1\/profiles\/[^/]+\/encounters$/.test(path) &&
    !path.startsWith("/media/")
  )
    return null;
  try {
    const i = await identity(db, auth, request.headers);
    if (!i) return reply({ code: "unauthenticated" }, 401);
    if (!i.policy || i.policy.status === "deleting")
      return reply({ code: "forbidden" }, 403);
    const method = request.method;
    if (!["GET", "POST", "PATCH", "DELETE"].includes(method))
      return reply({ code: "method_not_allowed" }, 405);
    if (
      method !== "GET" &&
      request.headers.get("origin") !==
        new URL((await auth.$context).baseURL).origin
    )
      return reply({ code: "forbidden" }, 403);
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
            await jsonBody(request),
            request.headers.get("idempotency-key") ?? "",
          ),
        },
        201,
      );
    else if (encounter && uuid(encounter[1]) && method === "GET")
      response = reply({ encounter: await service.detail(i, encounter[1]) });
    else if (encounter && uuid(encounter[1]) && method === "PATCH")
      response = reply({
        encounter: await service.edit(i, encounter[1], await jsonBody(request)),
      });
    else if (encounter && uuid(encounter[1]) && method === "DELETE") {
      await service.remove(i, encounter[1]);
      response = reply({ deleted: true });
    } else return reply({ code: "not_found" }, 404);
    const refresh = await auth.api.getSession({
      headers: request.headers,
      asResponse: true,
    });
    for (const cookie of refresh.headers.getSetCookie())
      response.headers.append("set-cookie", cookie);
    return response;
  } catch (error) {
    if (error instanceof EncounterError)
      return reply(
        {
          code: error.code,
          ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
        },
        error.status,
        error.retryAfter ? { "retry-after": String(error.retryAfter) } : {},
      );
    return reply({ code: "unavailable" }, 503);
  }
}
