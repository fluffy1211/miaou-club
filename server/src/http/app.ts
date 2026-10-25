import type {
  AccessResponse,
  ApiError,
  HealthResponse,
} from "@miaou/contracts";
import { Context, Data, Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import type { Pool } from "pg";
import type { Auth } from "../infrastructure/auth/auth.js";
import type { Database } from "../infrastructure/db/client.js";
import { encountersHTTP } from "../encounters/http.js";
import type { Encounters } from "../encounters/service.js";
import { dataHTTP } from "../data/http.js";
import type { DataManagement } from "../data/service.js";
import { accountsHTTP } from "../accounts/http.js";

import { friendsHTTP } from "../friends/http.js";
import type { Friends } from "../friends/service.js";

export const Services = Context.Service<{
  db: Database;
  pool: Pool;
  auth: Auth;
  friends?: Friends;
  encounters?: Encounters;
  dataManagement?: DataManagement;
}>("miaou/Services");
class Unavailable extends Data.TaggedError("Unavailable") {}
const external = <T>(action: () => Promise<T>) =>
  Effect.tryPromise({ try: action, catch: () => new Unavailable() });
const json = (body: AccessResponse | ApiError | HealthResponse, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

export const app = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const { db, pool, auth, encounters, dataManagement, friends } =
    yield* Services;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const path = new URL(webRequest.url).pathname;
  if (path === "/api/health" && request.method === "GET")
    return json({ status: "ok" });
  if (path === "/api/ready" && request.method === "GET") {
    yield* external(() => pool.query("select 1"));
    return json({ status: "ready" });
  }
  const friendsResponse = friends
    ? yield* external(() => friendsHTTP(webRequest, db, auth, friends))
    : null;
  if (friendsResponse) return HttpServerResponse.fromWeb(friendsResponse);
  const dataResponse = dataManagement
    ? yield* external(() => dataHTTP(webRequest, db, auth, dataManagement))
    : null;
  const mediaResponse =
    !dataResponse && encounters
      ? yield* external(() => encountersHTTP(webRequest, db, auth, encounters))
      : null;
  const response =
    dataResponse ??
    mediaResponse ??
    (yield* external(() => accountsHTTP(webRequest, db, auth)));
  return HttpServerResponse.fromWeb(response);
}).pipe(Effect.orElseSucceed(() => json({ code: "unavailable" }, 503)));
