import type {
  AccessResponse,
  ApiError,
  HealthResponse,
} from "@miaou/contracts";
import { Context, Data, Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "@effect/platform";
import type { Pool } from "pg";
import type { Auth } from "../infrastructure/auth/auth.js";
import type { Database } from "../infrastructure/db/client.js";
import { accountsHTTP } from "../accounts/http.js";

export const Services = Context.GenericTag<{
  db: Database;
  pool: Pool;
  auth: Auth;
}>("miaou/Services");
class Unavailable extends Data.TaggedError("Unavailable") {}
const external = <T>(action: () => Promise<T>) =>
  Effect.tryPromise({ try: action, catch: () => new Unavailable() });
const json = (body: AccessResponse | ApiError | HealthResponse, status = 200) =>
  HttpServerResponse.unsafeJson(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

export const app = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const { db, pool, auth } = yield* Services;
  const webRequest = yield* HttpServerRequest.toWeb(request);
  const path = new URL(webRequest.url).pathname;
  if (path === "/api/health" && request.method === "GET")
    return json({ status: "ok" });
  if (path === "/api/ready" && request.method === "GET") {
    yield* external(() => pool.query("select 1"));
    return json({ status: "ready" });
  }
  const response = yield* external(() => accountsHTTP(webRequest, db, auth));
  return HttpServerResponse.fromWeb(response);
}).pipe(
  Effect.catchAll(() => Effect.succeed(json({ code: "unavailable" }, 503))),
);
