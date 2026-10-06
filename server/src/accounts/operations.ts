import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../infrastructure/db/client.js";
import type { Auth } from "../infrastructure/auth/auth.js";
import {
  admission,
  user,
  userPolicy,
  session,
  twoFactor,
  verification,
  account,
} from "../infrastructure/db/schema.js";
import { audit, normalizeEmail, manualResetKey } from "./security.js";
export type Operation =
  | "admit"
  | "withdraw"
  | "suspend"
  | "reactivate"
  | "admin"
  | "recover-mfa"
  | "recover-account";
export async function operate(
  db: Database,
  auth: Auth,
  operator: string,
  command: Operation,
  emailInput: string,
  knownContact = false,
  replacementEmail?: string,
) {
  const email = normalizeEmail(emailInput);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Invalid email");
  if (command.startsWith("recover-") && !knownContact)
    throw new Error("Known-channel human validation required");
  if (
    command === "recover-account" &&
    (!replacementEmail || !auth.accountOptions.sendReset)
  )
    throw new Error("Replacement address and configured reset sender required");
  const replacement = replacementEmail
    ? normalizeEmail(replacementEmail)
    : undefined;
  if (replacement && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replacement))
    throw new Error("Invalid replacement address");
  let recovery: { email: string; token: string } | undefined;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
    const [target] = await tx.select().from(user).where(eq(user.email, email));
    if (command === "admit" || command === "withdraw") {
      await tx
        .insert(admission)
        .values({ email, active: command === "admit" })
        .onConflictDoUpdate({
          target: admission.email,
          set: { active: command === "admit", updatedAt: new Date() },
        });
      if (target)
        await tx
          .update(userPolicy)
          .set({
            admitted: command === "admit",
            ...(command === "withdraw" ? { status: "withdrawn" } : {}),
            updatedAt: new Date(),
          })
          .where(eq(userPolicy.userId, target.id));
    } else {
      if (!target) throw new Error("Account not found");
      if (command === "suspend" || command === "reactivate")
        await tx
          .update(userPolicy)
          .set({
            status: command === "suspend" ? "suspended" : "active",
            reason:
              command === "suspend" ? "Accès suspendu par Gabriel." : null,
            updatedAt: new Date(),
          })
          .where(eq(userPolicy.userId, target.id));
      if (command === "admin")
        await tx
          .update(userPolicy)
          .set({ role: "admin" })
          .where(eq(userPolicy.userId, target.id));
      if (command === "recover-mfa") {
        const [policy] = await tx
          .select()
          .from(userPolicy)
          .where(eq(userPolicy.userId, target.id));
        if (policy?.role !== "admin") throw new Error("Not an administrator");
        await tx.delete(session).where(eq(session.userId, target.id));
        await tx.delete(twoFactor).where(eq(twoFactor.userId, target.id));
        await tx.delete(verification).where(eq(verification.value, target.id));
        await tx
          .update(user)
          .set({ twoFactorEnabled: false })
          .where(eq(user.id, target.id));
        await tx
          .update(userPolicy)
          .set({ recoveryPending: true, recoveryEnrolled: false })
          .where(eq(userPolicy.userId, target.id));
      }
      if (command === "recover-account") {
        const [oldAdmission] = await tx
          .select()
          .from(admission)
          .where(eq(admission.email, email));
        await tx.delete(session).where(eq(session.userId, target.id));
        await tx.delete(account).where(eq(account.userId, target.id));
        await tx.delete(verification).where(eq(verification.value, target.id));
        await tx
          .update(user)
          .set({ email: replacement!, emailVerified: false })
          .where(eq(user.id, target.id));
        if (replacement !== email)
          await tx
            .update(admission)
            .set({ active: false })
            .where(eq(admission.email, email));
        await tx
          .insert(admission)
          .values({
            email: replacement!,
            active: oldAdmission?.active ?? false,
          })
          .onConflictDoUpdate({
            target: admission.email,
            set: { active: oldAdmission?.active ?? false },
          });
        // Native Better Auth resets consume this single-use row atomically.
        // No account transfer or new notebook; user id and policy/MFA survive.
        const token = randomUUID();
        await tx.insert(verification).values({
          id: randomUUID(),
          identifier: "reset-password:" + token,
          value: target.id,
          expiresAt: new Date(Date.now() + 1800000),
        });
        await tx.insert(verification).values({
          id: randomUUID(),
          identifier: manualResetKey(auth.accountOptions.secret, token),
          value: target.id,
          expiresAt: new Date(Date.now() + 1800000),
        });
        recovery = { email: replacement!, token };
      }
    }
    await audit(tx, operator, target?.id ?? "admission", command);
  });
  if (recovery)
    await auth.accountOptions.sendReset!(
      recovery.email,
      auth.accountOptions.baseURL + "/reinitialisation?token=" + recovery.token,
    );
}
