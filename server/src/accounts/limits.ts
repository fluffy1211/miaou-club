import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../infrastructure/db/client.js";
import { authLimit } from "../infrastructure/db/schema.js";
export class Limited extends Error {
  constructor(public retry: number) {
    super("limited");
  }
}
export class AuthLimits {
  constructor(
    private db: Database,
    private secret: string,
  ) {}
  key(value: string) {
    return createHmac("sha256", this.secret).update(value).digest("hex");
  }
  async reserve(value: string, bounds: [number, number][], now = Date.now()) {
    const key = this.key(value);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      const [record] = await tx
        .select()
        .from(authLimit)
        .where(eq(authLimit.key, key));
      const maxWindow = Math.max(...bounds.map((b) => b[0]));
      const events = (record?.events ?? []).filter((t) => now - t < maxWindow);
      for (const [window, maximum] of bounds) {
        const matching = events.filter((t) => now - t < window);
        if (matching.length >= maximum)
          throw new Limited(Math.ceil((matching[0] + window - now) / 1000));
      }
      await tx
        .insert(authLimit)
        .values({
          key,
          events: [...events, now],
          expiresAt: new Date(now + maxWindow),
        })
        .onConflictDoUpdate({
          target: authLimit.key,
          set: {
            events: [...events, now],
            expiresAt: new Date(now + maxWindow),
          },
        });
    });
  }
  async loginAllowed(email: string, now = Date.now()) {
    const [record] = await this.db
      .select()
      .from(authLimit)
      .where(eq(authLimit.key, this.key("login:" + email)));
    if (record?.blockedUntil && record.blockedUntil.getTime() > now)
      throw new Limited(
        Math.ceil((record.blockedUntil.getTime() - now) / 1000),
      );
  }
  async loginResult(email: string, success: boolean, now = Date.now()) {
    const key = this.key("login:" + email);
    if (success) {
      await this.db.delete(authLimit).where(eq(authLimit.key, key));
      return;
    }
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      const [record] = await tx
        .select()
        .from(authLimit)
        .where(eq(authLimit.key, key));
      const events = [
        ...(record?.events ?? []).filter((t) => now - t < 900000),
        now,
      ];
      const delay =
        events.length >= 5
          ? Math.min(900000, 30000 * 2 ** Math.min(5, events.length - 5))
          : 0;
      const blockedUntil = delay ? new Date(now + delay) : null;
      await tx
        .insert(authLimit)
        .values({
          key,
          events,
          blockedUntil,
          expiresAt: new Date(now + 900000),
        })
        .onConflictDoUpdate({
          target: authLimit.key,
          set: { events, blockedUntil, expiresAt: new Date(now + 900000) },
        });
    });
  }
}
