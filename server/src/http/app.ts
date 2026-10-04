import type {
  AccessResponse,
  ApiError,
  HealthResponse,
} from "@miaou/contracts";
import { Context, Data, Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import type { Auth } from "../infrastructure/auth/auth.js";
import type { Database } from "../infrastructure/db/client.js";
import { userPolicy } from "../infrastructure/db/policy-schema.js";

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
  if (path.startsWith("/api/auth/")) {
    const response = yield* external(() => auth.handler(webRequest));
    response.headers.set("cache-control", "no-store");
    return HttpServerResponse.fromWeb(response);
  }
  if (request.method !== "GET")
    return json({ code: "method_not_allowed" }, 405);
  if (path === "/api/health") return json({ status: "ok" });
  if (path === "/api/ready") {
    yield* external(() => pool.query("select 1"));
    return json({ status: "ready" });
  }
  if (path !== "/api/v1/access") return json({ code: "not_found" }, 404);
  const session = yield* external(() =>
    auth.api.getSession({ headers: webRequest.headers }),
  );
  if (!session) return json({ code: "unauthenticated" }, 401);
  // Live database lookup on every request; no cached admission/suspension.
  const policies = yield* external(() =>
    db
      .select()
      .from(userPolicy)
      .where(eq(userPolicy.userId, session.user.id))
      .limit(1),
  );
  const policy = policies[0];
  if (
    !session.user.emailVerified ||
    !policy?.admitted ||
    policy.status !== "active"
  )
    return json({ code: "forbidden" }, 403);
  return json({ status: "authorized" });
}).pipe(
  Effect.catchAll(() => Effect.succeed(json({ code: "unavailable" }, 503))),
);
