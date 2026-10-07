import "dotenv/config";
import { Friends } from "../friends/service.js";
import { DataManagement } from "../data/service.js";
import { Encounters } from "../encounters/service.js";
import { storageFromEnvironment } from "../encounters/storage.js";
import { setInterval, clearInterval } from "node:timers";
import { cleanupAccounts } from "../accounts/cleanup.js";
import { Effect, Layer } from "effect";
import { HttpApp } from "@effect/platform";
import { createDatabase, closePool } from "../infrastructure/db/client.js";
import { resetSender, inactivitySender } from "../accounts/mail.js";
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
          termsVersion: process.env.MIAOU_TERMS_VERSION,
          ...(process.env.RESEND_API_KEY && process.env.MIAOU_MAIL_FROM
            ? {
                sendReset: resetSender(
                  db,
                  process.env.RESEND_API_KEY,
                  process.env.MIAOU_MAIL_FROM,
                ),
              }
            : {}),
          ...(googleId && googleSecret
            ? { google: { clientId: googleId, clientSecret: googleSecret } }
            : {}),
        },
        schema,
      );
      const storage = storageFromEnvironment();
      const encounters = new Encounters(pool, storage);
      const dataManagement = new DataManagement(
        pool,
        storage,
        process.env.RESEND_API_KEY && process.env.MIAOU_MAIL_FROM
          ? inactivitySender(
              db,
              process.env.RESEND_API_KEY,
              process.env.MIAOU_MAIL_FROM,
              baseURL,
              secret,
            )
          : undefined,
      );
      let mediaRunning = false;
      const mediaClean = async () => {
        if (mediaRunning) return;
        mediaRunning = true;
        try {
          await encounters.maintenance();
          await dataManagement.maintenance();
        } catch {
          console.error(
            JSON.stringify({ component: "media", code: "maintenance_failed" }),
          );
        } finally {
          mediaRunning = false;
        }
      };
      void mediaClean();
      const mediaTimer = setInterval(() => {
        void mediaClean();
      }, 60000).unref();
      const clean = () =>
        cleanupAccounts(db).catch(() =>
          console.error(
            JSON.stringify({ component: "accounts", code: "cleanup_failed" }),
          ),
        );
      void clean();
      const cleanupTimer = setInterval(() => {
        void clean();
      }, 12 * 3600000).unref();
      return {
        db,
        pool,
        auth,
        encounters,
        friends: new Friends(pool),
        dataManagement,
        cleanupTimer,
        mediaTimer,
      };
    }),
    ({ pool, cleanupTimer, mediaTimer }) =>
      Effect.promise(async () => {
        clearInterval(cleanupTimer);
        clearInterval(mediaTimer);
        await closePool(pool);
      }),
  ),
);
const runtime = HttpApp.toWebHandlerLayer(app, layer);
export const handleRequest = runtime.handler;
export const dispose = runtime.dispose;
