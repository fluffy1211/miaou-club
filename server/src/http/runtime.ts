import "dotenv/config";
import { Effect, Layer } from "effect";
import { HttpApp } from "@effect/platform";
import { createDatabase } from "../infrastructure/db/client.js";
import { createAuth } from "../infrastructure/auth/auth.js";
import * as schema from "../infrastructure/db/schema.js";
import { app, Services } from "./app.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
const layer = Layer.scoped(
  Services,
  Effect.acquireRelease(
    Effect.sync(() => {
      const secret = required("BETTER_AUTH_SECRET");
      if (secret.length < 32)
        throw new Error(
          "BETTER_AUTH_SECRET must contain at least 32 characters",
        );
      const baseURL = required("BETTER_AUTH_URL");
      if (
        process.env.NODE_ENV === "production" &&
        new URL(baseURL).protocol !== "https:"
      )
        throw new Error("Production requires HTTPS");
      const googleId = process.env.GOOGLE_CLIENT_ID;
      const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (Boolean(googleId) !== Boolean(googleSecret))
        throw new Error("Incomplete Google configuration");
      const { db, pool } = createDatabase(required("DATABASE_URL"));
      const auth = createAuth(
        db,
        {
          secret,
          baseURL,
          ...(googleId && googleSecret
            ? { google: { clientId: googleId, clientSecret: googleSecret } }
            : {}),
        },
        schema,
      );
      return { db, pool, auth };
    }),
    ({ pool }) => Effect.promise(() => pool.end()),
  ),
);
const runtime = HttpApp.toWebHandlerLayer(app, layer);
export const handleRequest = runtime.handler;
export const dispose = runtime.dispose;
