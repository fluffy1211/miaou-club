import { lt } from "drizzle-orm";
import type { Database } from "../infrastructure/db/client.js";
import {
  session,
  verification,
  authLimit,
  mailAttempt,
  securityAudit,
} from "../infrastructure/db/schema.js";
export async function cleanupAccounts(db: Database, now = new Date()) {
  const sixMonths = new Date(now);
  sixMonths.setUTCMonth(sixMonths.getUTCMonth() - 6);
  await db.transaction(async (tx) => {
    await tx.delete(session).where(lt(session.expiresAt, now));
    await tx.delete(verification).where(lt(verification.expiresAt, now));
    await tx.delete(authLimit).where(lt(authLimit.expiresAt, now));
    await tx
      .delete(mailAttempt)
      .where(
        lt(mailAttempt.createdAt, new Date(now.getTime() - 30 * 86400000)),
      );
    await tx
      .delete(securityAudit)
      .where(lt(securityAudit.createdAt, sixMonths));
  });
}
