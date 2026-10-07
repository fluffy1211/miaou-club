import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../infrastructure/db/client.js";
import {
  admission,
  userPolicy,
  sessionSecurity,
  session,
  securityAudit,
  accountActivity,
} from "../infrastructure/db/schema.js";
type SessionReader = {
  api: {
    getSession(options: { headers: Headers }): Promise<{
      user: {
        id: string;
        email: string;
        name: string;
        twoFactorEnabled?: boolean | null;
      };
      session: {
        id: string;
        token: string;
        userId: string;
        createdAt: Date;
        expiresAt: Date;
      };
    } | null>;
  };
};
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export function safeReturn(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\/(?!\/)/.test(value) ||
    /[\\\r\n]/.test(value)
  )
    return "/profil";
  try {
    const url = new URL(value, "https://internal.invalid");
    if (
      url.origin !== "https://internal.invalid" ||
      url.pathname.startsWith("/api/")
    )
      return "/profil";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/profil";
  }
}
export const manualResetKey = (secret: string, token: string) =>
  "manual-reset:" + createHmac("sha256", secret).update(token).digest("hex");
export const consentCookie = "miaou.consent";
export function signConsent(secret: string, version: string) {
  const body = Buffer.from(
    JSON.stringify({ version, expires: Date.now() + 600000 }),
  ).toString("base64url");
  return body + "." + createHmac("sha256", secret).update(body).digest("hex");
}
export function readConsent(
  headers: Headers | undefined,
  secret: string,
  version: string,
) {
  const token = headers
    ?.get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(consentCookie + "="))
    ?.slice(consentCookie.length + 1);
  if (!token) return false;
  const [body, signature] = token.split(".");
  if (!body || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return false;
  try {
    const proof = JSON.parse(Buffer.from(body, "base64url").toString());
    return proof.version === version && proof.expires > Date.now();
  } catch {
    return false;
  }
}
export async function admitted(db: Database, email: string) {
  return Boolean(
    (
      await db
        .select()
        .from(admission)
        .where(
          and(
            eq(admission.email, normalizeEmail(email)),
            eq(admission.active, true),
          ),
        )
        .limit(1)
    )[0],
  );
}
export async function audit(
  db: Pick<Database, "insert">,
  actor: string,
  target: string,
  action: string,
) {
  await db
    .insert(securityAudit)
    .values({ id: randomUUID(), actor, target, action });
}
// Lock 7 is shared with the final inactivity/deletion decision, independently
// of the owner/media lock. The preliminary scan must not block a member's return.
export async function recordActivity(
  db: Database,
  ownerId: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${ownerId},7))`,
    );
    const [policy] = await tx
      .select()
      .from(userPolicy)
      .where(eq(userPolicy.userId, ownerId));
    if (policy?.status === "deleting") return false;
    await tx
      .insert(accountActivity)
      .values({ ownerId, lastUsedAt: now })
      .onConflictDoUpdate({
        target: accountActivity.ownerId,
        set: { lastUsedAt: now, warnedAt: null },
      });
    return true;
  });
}
export async function identity(
  db: Database,
  auth: SessionReader,
  headers: Headers,
  now = new Date(),
) {
  const current = await auth.api.getSession({ headers });
  if (!current) return null;
  const [security] = await db
    .select()
    .from(sessionSecurity)
    .where(eq(sessionSecurity.sessionId, current.session.id));
  if (
    !security ||
    now.getTime() - security.authenticatedAt.getTime() >= 30 * 86400000 ||
    now.getTime() - security.usedAt.getTime() >= 7 * 86400000
  ) {
    await db.delete(session).where(eq(session.id, current.session.id));
    return null;
  }
  await db
    .update(sessionSecurity)
    .set({ usedAt: now })
    .where(eq(sessionSecurity.sessionId, current.session.id));
  // Keep the identity for the existing status gate (403), without recording
  // activity on a deleting account. Real deletion separately revokes sessions.
  await recordActivity(db, current.user.id, now);
  const [policy] = await db
    .select()
    .from(userPolicy)
    .where(eq(userPolicy.userId, current.user.id));
  return {
    ...current,
    security,
    policy,
    admission: await admitted(db, current.user.email),
  };
}
export type Identity = NonNullable<Awaited<ReturnType<typeof identity>>>;
export const groupAllowed = (i: Identity) =>
  Boolean(
    i.admission &&
    i.policy?.admitted &&
    i.policy.status === "active" &&
    i.policy.acceptedAt &&
    i.policy.termsVersion,
  );
export const fresh = (i: Identity, now = Date.now()) =>
  now - i.security.reauthenticatedAt.getTime() < 300000;
export const mfaValid = (i: Identity, now = Date.now()) =>
  Boolean(
    !i.policy?.recoveryPending &&
    i.user.twoFactorEnabled &&
    i.security.mfaAt &&
    now - i.security.mfaAt.getTime() < 8 * 3600000 &&
    i.security.adminUsedAt &&
    now - i.security.adminUsedAt.getTime() < 900000,
  );
export const sensitiveAllowed = (i: Identity) =>
  fresh(i) && (i.policy?.role !== "admin" || mfaValid(i));
