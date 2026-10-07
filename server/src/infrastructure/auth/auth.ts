import { accountActivity } from "../db/data-schema.js";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import type { GoogleOptions } from "better-auth/social-providers";
import { twoFactor } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { eq, and, ne } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  profile,
  userPolicy,
  sessionSecurity,
  session,
  twoFactor as twoFactorRecord,
  user,
  verification,
  account,
} from "../db/schema.js";
import {
  admitted,
  normalizeEmail,
  readConsent,
  sensitiveAllowed,
  identity,
  fresh,
  audit,
  manualResetKey,
} from "../../accounts/security.js";
export type AuthOptions = {
  secret: string;
  baseURL: string;
  termsVersion?: string;
  google?: GoogleOptions;
  sendReset?: (email: string, url: string) => Promise<void>;
};
export function createAuth(
  db: Database,
  options: AuthOptions,
  schema?: Record<string, unknown>,
) {
  const config = {
    logger: {
      log: (level) =>
        console.error(
          JSON.stringify({ component: "auth", level, code: "auth_diagnostic" }),
        ),
    },
    secret: options.secret,
    baseURL: options.baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      ...(schema ? { schema } : {}),
    }),
    trustedOrigins: [options.baseURL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.termsVersion,
      requireEmailVerification: false,
      minPasswordLength: 12,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      ...(options.sendReset
        ? {
            sendResetPassword: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => options.sendReset!(user.email, url),
          }
        : {}),
    },
    socialProviders: options.google
      ? {
          google: {
            ...options.google,
            disableSignUp: !options.termsVersion,
            prompt: "select_account" as const,
          },
        }
      : {},
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
      },
    },
    session: {
      expiresIn: 7 * 86400,
      freshAge: 300,
      cookieCache: { enabled: false },
    },
    // Ordinary sessions stay available; every administrative route also requires
    // the server-owned session_security MFA proof, including after Google OAuth.
    plugins: [twoFactor({ issuer: "Miaou Club", allowPasswordless: true })],
    advanced: {
      useSecureCookies: new URL(options.baseURL).protocol === "https:",
      ipAddress: { disableIpTracking: true },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (a, ctx) => {
            if (a.providerId === "google") {
              const [existing] = await db
                .select()
                .from(account)
                .where(eq(account.userId, a.userId));
              if (existing) {
                const i = await identity(
                  db,
                  auth,
                  ctx?.headers ?? new Headers(),
                );
                if (!i || i.user.id !== a.userId || !sensitiveAllowed(i))
                  throw new APIError("FORBIDDEN", {
                    message: "Réauthentification requise.",
                  });
              }
            }
            return { data: a };
          },
        },
      },
      user: {
        create: {
          before: async (u, ctx) => {
            if (
              !options.termsVersion ||
              !readConsent(
                ctx?.headers,
                options.secret,
                options.termsVersion,
              ) ||
              !(await admitted(db, u.email))
            )
              throw new APIError("FORBIDDEN", {
                message: "Accès non autorisé.",
              });
            return { data: { ...u, email: normalizeEmail(u.email) } };
          },
          after: async (u) => {
            await db.transaction(async (tx) => {
              await tx.insert(userPolicy).values({
                userId: u.id,
                admitted: true,
                acceptedAt: new Date(),
                termsVersion: options.termsVersion!,
              });
              await tx
                .insert(profile)
                .values({ userId: u.id, displayName: u.name.slice(0, 60) });
            });
          },
        },
      },
      session: {
        create: {
          after: async (s, ctx) => {
            const oldId = ctx?.path.startsWith("/two-factor/")
              ? ctx.context.session?.session.id
              : undefined;
            const old = oldId
              ? (
                  await db
                    .select()
                    .from(sessionSecurity)
                    .where(eq(sessionSecurity.sessionId, oldId))
                )[0]
              : null;
            const now = new Date();
            await db
              .insert(accountActivity)
              .values({ ownerId: s.userId, lastUsedAt: now })
              .onConflictDoUpdate({
                target: accountActivity.ownerId,
                set: { lastUsedAt: now, warnedAt: null },
              });
            await db.insert(sessionSecurity).values({
              sessionId: s.id,
              authenticatedAt: old?.authenticatedAt ?? now,
              usedAt: now,
              reauthenticatedAt: old?.reauthenticatedAt ?? now,
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/two-factor/disable" ||
          ctx.path === "/change-email" ||
          ctx.path === "/delete-user" ||
          ctx.path === "/set-password"
        )
          throw new APIError("FORBIDDEN", {
            message: "Parcours non autorisé.",
          });
        if (
          ctx.path === "/reset-password" &&
          typeof ctx.body?.token === "string"
        ) {
          const [reset] = await db
            .select()
            .from(verification)
            .where(
              eq(verification.identifier, "reset-password:" + ctx.body.token),
            );
          if (reset && reset.expiresAt.getTime() > Date.now()) {
            const [credential] = await db
              .select()
              .from(account)
              .where(
                and(
                  eq(account.userId, reset.value),
                  eq(account.providerId, "credential"),
                ),
              );
            if (!credential) {
              const [manual] = await db
                .select()
                .from(verification)
                .where(
                  eq(
                    verification.identifier,
                    manualResetKey(options.secret, ctx.body.token),
                  ),
                );
              const i = await identity(db, auth, ctx.headers ?? new Headers());
              if (
                !(
                  manual?.value === reset.value &&
                  manual.expiresAt.getTime() > Date.now()
                ) &&
                (!i || i.user.id !== reset.value || !sensitiveAllowed(i))
              )
                throw new APIError("FORBIDDEN", {
                  message: "Réauthentification requise.",
                });
            }
          }
        }
        if (ctx.path.startsWith("/two-factor/")) {
          if (ctx.body?.trustDevice)
            throw new APIError("FORBIDDEN", {
              message: "Nouvelle vérification requise à chaque session.",
            });
          if (
            [
              "/two-factor/enable",
              "/two-factor/get-totp-uri",
              "/two-factor/generate-backup-codes",
            ].includes(ctx.path)
          ) {
            const i = await identity(db, auth, ctx.headers ?? new Headers());
            const enrolling = i && !i.user.twoFactorEnabled;
            if (
              !i ||
              i.policy?.role !== "admin" ||
              !fresh(i) ||
              (!enrolling && !i.policy.recoveryPending && !sensitiveAllowed(i))
            )
              throw new APIError("FORBIDDEN", {
                message: "Réauthentification et MFA requis.",
              });
          }
        }
        if (
          ["/link-social", "/unlink-account", "/change-password"].includes(
            ctx.path,
          )
        ) {
          const i = await identity(db, auth, ctx.headers ?? new Headers());
          if (!i || !sensitiveAllowed(i))
            throw new APIError("FORBIDDEN", {
              message: "Réauthentification requise.",
            });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/two-factor/enable" &&
          ctx.context.returned &&
          !(ctx.context.returned instanceof APIError)
        ) {
          const i = await identity(db, auth, ctx.headers ?? new Headers());
          if (i?.policy?.recoveryPending)
            await db
              .update(userPolicy)
              .set({ recoveryEnrolled: true })
              .where(eq(userPolicy.userId, i.user.id));
          return;
        }
        if (
          ![
            "/two-factor/verify-totp",
            "/two-factor/verify-backup-code",
          ].includes(ctx.path)
        )
          return;
        const returned = ctx.context.returned as { token?: string } | null;
        if (!returned?.token) return;
        const s =
          ctx.context.newSession?.session ??
          (
            await db
              .select()
              .from(session)
              .where(eq(session.token, returned.token))
          )[0];
        if (!s) return;
        if (ctx.path.endsWith("verify-backup-code")) {
          await db.transaction(async (tx) => {
            await tx
              .delete(session)
              .where(and(eq(session.userId, s.userId), ne(session.id, s.id)));
            await tx
              .delete(twoFactorRecord)
              .where(eq(twoFactorRecord.userId, s.userId));
            await tx
              .delete(verification)
              .where(eq(verification.value, s.userId));
            await tx
              .update(user)
              .set({ twoFactorEnabled: false })
              .where(eq(user.id, s.userId));
            await tx
              .update(userPolicy)
              .set({ recoveryPending: true, recoveryEnrolled: false })
              .where(eq(userPolicy.userId, s.userId));
          });
          await audit(db, s.userId, s.userId, "mfa_backup_recovery_started");
          return;
        }
        const [policy] = await db
          .select()
          .from(userPolicy)
          .where(eq(userPolicy.userId, s.userId));
        // An old TOTP cannot complete backup recovery. Recovery requires a newly
        // enrolled factor; /enable marks this separately in the application.
        if (policy?.recoveryPending) {
          if (!policy.recoveryEnrolled) return;
          await db
            .delete(session)
            .where(and(eq(session.userId, s.userId), ne(session.id, s.id)));
          await db
            .update(userPolicy)
            .set({ recoveryPending: false, recoveryEnrolled: false })
            .where(eq(userPolicy.userId, s.userId));
          await audit(db, s.userId, s.userId, "mfa_recovery_completed");
        }
        const now = new Date();
        await db
          .update(sessionSecurity)
          .set({ mfaAt: now, adminUsedAt: now })
          .where(eq(sessionSecurity.sessionId, s.id));
      }),
    },
  } satisfies BetterAuthOptions;
  const auth = betterAuth(config);
  return Object.assign(auth, { accountOptions: options });
}
export type Auth = ReturnType<typeof createAuth>;
