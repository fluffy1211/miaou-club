import { and, eq, ne, sql, isNotNull } from "drizzle-orm";
import { decodeHandle } from "../http/path.js";
import type { Database } from "../infrastructure/db/client.js";
import type { Auth } from "../infrastructure/auth/auth.js";
import {
  user,
  profile,
  userPolicy,
  sessionSecurity,
  session,
  account,
  admission,
  authLimit,
} from "../infrastructure/db/schema.js";
import {
  admitted,
  consentCookie,
  signConsent,
  groupAllowed,
  identity,
  mfaValid,
  sensitiveAllowed,
  safeReturn,
  normalizeEmail,
  audit,
} from "./security.js";
import { operate } from "./operations.js";
import { AuthLimits, Limited } from "./limits.js";
export function reply(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}
const deny = () => reply({ code: "forbidden" }, 403);
const bad = () => reply({ code: "invalid_request" }, 400);
export async function accountsHTTP(
  request: Request,
  db: Database,
  auth: Auth,
  now = new Date(),
): Promise<Response> {
  const native = new URL(request.url).pathname.startsWith("/api/auth/");
  const refresh = native
    ? null
    : await auth.api.getSession({ headers: request.headers, asResponse: true });
  const response = await accountsHTTPInternal(request, db, auth, now);
  if (response.status !== 401 && refresh) {
    for (const cookie of refresh.headers.getSetCookie())
      response.headers.append("set-cookie", cookie);
  }
  return response;
}
async function accountsHTTPInternal(
  request: Request,
  db: Database,
  auth: Auth,
  now = new Date(),
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const authContext = await auth.$context;
  const base = new URL(authContext.baseURL).origin;
  const limits = new AuthLimits(db, authContext.secret);
  if (!["GET", "POST", "PATCH"].includes(request.method))
    return reply({ code: "method_not_allowed" }, 405);
  if (request.method !== "GET" && request.headers.get("origin") !== base)
    return deny();
  let body: Record<string, unknown> = {};
  if (request.method !== "GET") {
    const raw = await request.text();
    if (raw.length > 8192) return reply({ code: "invalid_request" }, 413);
    try {
      body = JSON.parse(raw);
    } catch {
      return bad();
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return bad();
  }
  try {
    // Expire obsolete sessions before any native authenticated endpoint can use
    // them. Anonymous reset, sign-in and OAuth callbacks remain available.
    const i = await identity(db, auth, request.headers, now);
    if (path.startsWith("/api/auth/")) {
      if (
        [
          "/api/auth/update-user",
          "/api/auth/change-email",
          "/api/auth/delete-user",
        ].includes(path)
      )
        return deny();
      const headers = new Headers(request.headers);
      let proof: string | undefined;
      if (
        path === "/api/auth/sign-up/email" ||
        (path === "/api/auth/sign-in/social" && body.acceptedTerms === true)
      ) {
        const version = auth.accountOptions.termsVersion;
        if (!version || body.acceptedTerms !== true) return deny();
        if (
          path.endsWith("sign-up/email") &&
          (typeof body.email !== "string" || !(await admitted(db, body.email)))
        )
          return deny();
        proof = signConsent(authContext.secret, version);
        // Replace rather than append a caller-supplied proof cookie.
        const cookies = (headers.get("cookie") ?? "")
          .split(";")
          .filter((c) => !c.trim().startsWith(consentCookie + "="))
          .join(";");
        headers.set("cookie", cookies + "; " + consentCookie + "=" + proof);
      }
      if (path === "/api/auth/sign-up/email" && !proof) return deny();
      if (path === "/api/auth/request-password-reset") {
        if (typeof body.email !== "string") return bad();
        if (!authContext.options.emailAndPassword?.sendResetPassword)
          return reply({ code: "mail_unavailable" }, 503);
        const email = normalizeEmail(body.email);
        await limits.reserve("mail:" + email, [
          [60000, 1],
          [3600000, 3],
          [86400000, 5],
        ]);
        await limits.reserve("mail:global", [[86400000, 100]]);
        const [target] = await db
          .select()
          .from(user)
          .where(eq(user.email, email));
        if (target) {
          const credentials = await db
            .select()
            .from(account)
            .where(
              and(
                eq(account.userId, target.id),
                eq(account.providerId, "credential"),
              ),
            );
          // Creating a password for a Google account is an explicit sensitive
          // operation, never an anonymous implicit account-linking shortcut.
          if (
            !credentials.length &&
            (!i || i.user.id !== target.id || !sensitiveAllowed(i))
          )
            return reply({
              status: true,
              message:
                "If this email exists in our system, check your email for the reset link",
            });
        }
        body.redirectTo = base + "/reinitialisation";
      }
      if (path === "/api/auth/sign-in/email") {
        if (typeof body.email !== "string") return bad();
        await limits.loginAllowed(normalizeEmail(body.email));
        const ip = request.headers.get("x-miaou-client-ip");
        if (ip) await limits.reserve("ip:login:" + ip, [[900000, 60]]);
      }
      if (
        path === "/api/auth/sign-in/social" ||
        path === "/api/auth/link-social"
      ) {
        if (body.provider !== "google" || body.idToken) return deny();
        body.callbackURL = base + safeReturn(body.callbackURL);
        body.errorCallbackURL = base + "/profil?erreur=connexion";
      }
      if (path === "/api/auth/change-password") body.revokeOtherSessions = true;
      // Never enable trusted-device bypass of the new-session admin MFA policy.
      if (body.trustDevice) return deny();
      const forwarded = new Request(request.url, {
        method: request.method,
        headers,
        ...(request.method !== "GET" ? { body: JSON.stringify(body) } : {}),
      });
      const response = await auth.handler(forwarded);
      response.headers.set("cache-control", "no-store");
      if (proof)
        response.headers.append(
          "set-cookie",
          `${consentCookie}=${proof}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${base.startsWith("https:") ? "; Secure" : ""}`,
        );
      if (path === "/api/auth/sign-in/email")
        await limits.loginResult(
          normalizeEmail(String(body.email)),
          response.ok,
        );
      return response;
    }
    if (path === "/api/v1/access")
      return !i
        ? reply({ code: "unauthenticated" }, 401)
        : groupAllowed(i)
          ? reply({ status: "authorized" })
          : deny();
    if (path === "/api/v1/auth-options" && request.method === "GET")
      return reply({
        google: Boolean(authContext.options.socialProviders?.google),
        signup: Boolean(
          authContext.options.emailAndPassword?.disableSignUp === false,
        ),
      });
    if (!i) return reply({ code: "unauthenticated" }, 401);
    if (i.policy?.status === "deleting") return deny();
    if (path === "/api/v1/me" && request.method === "GET") {
      const [p] = await db
        .select()
        .from(profile)
        .where(eq(profile.userId, i.user.id));
      const methods = await db
        .select({ provider: account.providerId })
        .from(account)
        .where(eq(account.userId, i.user.id));
      return reply({
        user: { id: i.user.id, email: i.user.email },
        profile: p ?? null,
        access: groupAllowed(i) ? "group" : "personal",
        status: i.policy?.status ?? "unadmitted",
        reason: i.policy?.reason ?? null,
        role: i.policy?.role ?? "user",
        methods: methods.map((x) => x.provider),
        mfaEnabled: Boolean(i.user.twoFactorEnabled),
        mfaValid: mfaValid(i),
        recoveryPending: Boolean(i.policy?.recoveryPending),
      });
    }
    if (path === "/api/v1/reauth" && request.method === "POST") {
      if (typeof body.password !== "string") return bad();
      await limits.loginAllowed(i.user.email);
      try {
        await auth.api.verifyPassword({
          headers: request.headers,
          body: { password: body.password },
        });
      } catch {
        await limits.loginResult(i.user.email, false);
        return deny();
      }
      await limits.loginResult(i.user.email, true);
      await db
        .update(sessionSecurity)
        .set({ reauthenticatedAt: now })
        .where(eq(sessionSecurity.sessionId, i.session.id));
      return reply({ status: true });
    }
    if (path === "/api/v1/me/profile" && request.method === "PATCH") {
      if (!groupAllowed(i)) return deny();
      if (
        Object.keys(body).some(
          (k) =>
            !["handle", "displayName", "bio", "color", "avatar"].includes(k),
        )
      )
        return bad();
      const displayName = body.displayName;
      const bio = body.bio ?? "";
      const color = body.color ?? "violet";
      const avatar = body.avatar ?? "initials";
      const handle =
        typeof body.handle === "string"
          ? body.handle.trim().toLowerCase()
          : null;
      if (
        typeof displayName !== "string" ||
        !displayName.trim() ||
        displayName.length > 60 ||
        typeof bio !== "string" ||
        bio.length > 240 ||
        !["violet", "corail", "sauge"].includes(String(color)) ||
        !["initials", "cat"].includes(String(avatar)) ||
        !handle ||
        !/^[a-z0-9_]{3,30}$/.test(handle) ||
        ["admin", "miaou", "support", "system"].includes(handle)
      )
        return bad();
      try {
        return await db.transaction(async (tx) => {
          await tx.execute(
            sql`select user_id from profile where user_id = ${i.user.id} for update`,
          );
          const [old] = await tx
            .select()
            .from(profile)
            .where(eq(profile.userId, i.user.id));
          if (!old || (old.handle && old.handle !== handle)) return deny();
          const [p] = await tx
            .update(profile)
            .set({
              handle,
              displayName: displayName.trim(),
              bio,
              color: String(color),
              avatar: String(avatar),
            })
            .where(eq(profile.userId, i.user.id))
            .returning();
          return reply({ profile: p });
        });
      } catch (error) {
        if ((error as { cause?: { code?: string } }).cause?.code === "23505")
          return reply({ code: "conflict" }, 409);
        throw error;
      }
    }
    if (path.startsWith("/api/v1/profiles/") && request.method === "GET") {
      if (!groupAllowed(i)) return deny();
      const handle = decodeHandle(path.slice("/api/v1/profiles/".length));
      if (handle === null) return reply({ code: "invalid_request" }, 400);
      const [p] = await db
        .select({
          handle: profile.handle,
          displayName: profile.displayName,
          bio: profile.bio,
          color: profile.color,
          avatar: profile.avatar,
        })
        .from(profile)
        .innerJoin(userPolicy, eq(userPolicy.userId, profile.userId))
        .innerJoin(user, eq(user.id, profile.userId))
        .innerJoin(admission, eq(admission.email, user.email))
        .where(
          and(
            eq(profile.handle, handle),
            eq(userPolicy.status, "active"),
            eq(userPolicy.admitted, true),
            eq(admission.active, true),
            isNotNull(userPolicy.acceptedAt),
            isNotNull(userPolicy.termsVersion),
          ),
        );
      return p ? reply({ profile: p }) : reply({ code: "not_found" }, 404);
    }
    if (path === "/api/v1/admin/access" && request.method === "GET") {
      if (!groupAllowed(i) || i.policy?.role !== "admin" || !mfaValid(i))
        return deny();
      // A status read or background refresh is not administrative activity.
      return reply({ status: "authorized" });
    }
    if (path === "/api/v1/admin/mail-quota" && request.method === "GET") {
      if (!groupAllowed(i) || i.policy?.role !== "admin" || !mfaValid(i))
        return deny();
      const [quota] = await db
        .select()
        .from(authLimit)
        .where(eq(authLimit.key, limits.key("mail:global")));
      return reply({
        requestedLast24Hours: (quota?.events ?? []).filter(
          (t) => now.getTime() - t < 86400000,
        ).length,
        applicationDailyLimit: 100,
      });
    }
    if (path === "/api/v1/admin/admissions") {
      if (!groupAllowed(i) || i.policy?.role !== "admin" || !mfaValid(i))
        return deny();
      if (request.method === "GET")
        return reply({ admissions: await db.select().from(admission) });
      if (request.method === "POST") {
        if (
          typeof body.email !== "string" ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
          !["admit", "withdraw"].includes(String(body.action))
        )
          return bad();
        await operate(
          db,
          auth,
          i.user.id,
          body.action as "admit" | "withdraw",
          body.email,
        );
        await db
          .update(sessionSecurity)
          .set({ adminUsedAt: now })
          .where(eq(sessionSecurity.sessionId, i.session.id));
        return reply({ status: true });
      }
      return reply({ code: "method_not_allowed" }, 405);
    }
    // Full exports, deletion and moderation arrive in lot 5. Their permission
    // boundary is executable now, without pretending a ZIP or purge exists.
    if (
      ["/api/v1/me/export", "/api/v1/me/deletion"].includes(path) &&
      request.method === "POST"
    ) {
      if (!sensitiveAllowed(i)) return deny();
      return reply({ code: "not_implemented" }, 501);
    }
    if (path === "/api/v1/me/revoke-others" && request.method === "POST") {
      if (!sensitiveAllowed(i)) return deny();
      await db
        .delete(session)
        .where(
          and(eq(session.userId, i.user.id), ne(session.id, i.session.id)),
        );
      await audit(db, i.user.id, i.user.id, "other_sessions_revoked");
      return reply({ status: true });
    }
    return reply({ code: "not_found" }, 404);
  } catch (error) {
    if (error instanceof Limited)
      return reply({ code: "limited", retryAfter: error.retry }, 429, {
        "retry-after": String(error.retry),
      });
    throw error;
  }
}
