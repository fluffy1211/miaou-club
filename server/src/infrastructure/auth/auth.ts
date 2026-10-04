import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "../db/client.js";

export function createAuth(
  db: Database,
  options: {
    secret: string;
    baseURL: string;
    google?: { clientId: string; clientSecret: string };
  },
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
      disableSignUp: true,
      requireEmailVerification: true,
    },
    socialProviders: options.google
      ? { google: { ...options.google, disableSignUp: true } }
      : {},
    account: { accountLinking: { enabled: false } },
    session: { expiresIn: 7 * 86400, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: new URL(options.baseURL).protocol === "https:",
    },
  } satisfies BetterAuthOptions;
  return betterAuth(config);
}
export type Auth = ReturnType<typeof createAuth>;
