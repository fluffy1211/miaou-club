import type { Database } from "../infrastructure/db/client.js";
import type { Auth } from "../infrastructure/auth/auth.js";
import { identity, groupAllowed, type Identity } from "../accounts/security.js";
import { reply } from "../accounts/http.js";

/** Domain failure answered as `{ code, retryAfter? }` with its HTTP status. */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
export const uuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);

const BODY_LIMIT = 8192;
async function readJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("invalid_request");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > BODY_LIMIT) {
      await reader.cancel();
      throw new ApiError("invalid_request", 413);
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError("invalid_request");
  }
}

export type MemberRequest = {
  request: Request;
  identity: Identity;
  url: URL;
  path: string;
  method: string;
  /** JSON object body, at most 8 KiB. */
  body: () => Promise<Record<string, unknown>>;
};
type Options = {
  /** Paths this domain answers; others fall through to the next domain. */
  owns: (path: string) => boolean;
  methods: string[];
  /** "member": any non-deleting account; "group": member allowed in the club. */
  access: "member" | "group";
};

/**
 * Shared gate of member API domains: method, session, account access and
 * same-origin checks for mutations, ApiError mapping and session cookie
 * refresh. Domain handlers only route and call their service.
 */
export async function memberAPI(
  request: Request,
  db: Database,
  auth: Auth,
  options: Options,
  handle: (r: MemberRequest) => Promise<Response>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!options.owns(url.pathname)) return null;
  const response = await guarded(request, db, auth, options, url, handle);
  if (response.status !== 401) {
    const refresh = await auth.api.getSession({
      headers: request.headers,
      asResponse: true,
    });
    for (const cookie of refresh.headers.getSetCookie())
      response.headers.append("set-cookie", cookie);
  }
  return response;
}

async function guarded(
  request: Request,
  db: Database,
  auth: Auth,
  options: Options,
  url: URL,
  handle: (r: MemberRequest) => Promise<Response>,
) {
  try {
    const method = request.method;
    if (!options.methods.includes(method))
      return reply({ code: "method_not_allowed" }, 405);
    const i = await identity(db, auth, request.headers);
    if (!i) return reply({ code: "unauthenticated" }, 401);
    const allowed =
      options.access === "group"
        ? groupAllowed(i)
        : Boolean(i.policy && i.policy.status !== "deleting");
    if (!allowed) return reply({ code: "forbidden" }, 403);
    if (
      method !== "GET" &&
      request.headers.get("origin") !==
        new URL((await auth.$context).baseURL).origin
    )
      return reply({ code: "forbidden" }, 403);
    return await handle({
      request,
      identity: i,
      url,
      path: url.pathname,
      method,
      body: () => readJson(request),
    });
  } catch (error) {
    if (error instanceof ApiError)
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
