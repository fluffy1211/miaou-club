import { AuthLimits } from "./limits.js";
import { randomUUID } from "node:crypto";
import type { Database } from "../infrastructure/db/client.js";
import { mailAttempt } from "../infrastructure/db/schema.js";
export function resetSender(db: Database, key: string, from: string) {
  return async (email: string, url: string) => {
    let result = "failed";
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          authorization: "Bearer " + key,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Réinitialiser ton mot de passe Miaou Club",
          text:
            "Pour choisir un nouveau mot de passe, ouvre ce lien valable 30 minutes :\n" +
            url +
            "\nSi tu n’as rien demandé, ignore ce message.",
        }),
      });
      if (!response.ok) throw new Error("mail_delivery_failed");
      result = "accepted";
    } finally {
      await db.insert(mailAttempt).values({
        id: randomUUID(),
        recipient: email,
        type: "password_reset",
        result,
      });
    }
  };
}

export function inactivitySender(
  db: Database,
  key: string,
  from: string,
  baseURL: string,
  secret: string,
) {
  const limits = new AuthLimits(db, secret);
  const text =
    "Ton compte Miaou Club n’a pas été utilisé depuis 24 mois. Tu disposes de 30 jours pour te reconnecter et conserver ton compte, ou copier tes données depuis ton profil :\n" +
    new URL("/donnees", baseURL).href +
    "\nSans retour pendant ce délai, ton compte et tes souvenirs seront supprimés. Pour une aide ou un complément, contacte Gabriel par le canal connu.";
  return async (email: string, idempotencyKey: string) => {
    await limits.reserve("mail:global", [[86400000, 100]]);
    let result = "failed";
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          authorization: "Bearer " + key,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Ton compte Miaou Club est inactif",
          text,
        }),
      });
      if (!response.ok) throw new Error("mail_delivery_failed");
      result = "accepted";
    } finally {
      await db.insert(mailAttempt).values({
        id: randomUUID(),
        recipient: email,
        type: "inactivity_warning",
        result,
      });
    }
  };
}
