import { randomUUID, createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  groupAllowed,
  mfaValid,
  sensitiveAllowed,
  type Identity,
} from "../accounts/security.js";
import { EncounterError, uuid } from "../encounters/service.js";
import { objectKeys, type ObjectStorage } from "../encounters/storage.js";
import { zip, csv } from "./archive.js";
const fail = (code: string, status = 400): never => {
  throw new EncounterError(code, status);
};
const reason = (input: unknown) =>
  typeof input === "string" && input.trim().length > 0 && input.length <= 1000
    ? input.trim()
    : fail("invalid_request");
export class DataManagement {
  constructor(
    private pool: Pool,
    private storage: ObjectStorage,
    private sendInactivity?: (email: string, key: string) => Promise<void>,
  ) {}
  private async transaction<T>(
    run: (c: PoolClient) => Promise<T>,
    repeatable = false,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query(
        repeatable ? "begin isolation level repeatable read" : "begin",
      );
      const result = await run(c);
      await c.query("commit");
      return result;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  private async policy(
    c: PoolClient,
    i: Identity,
    admin = false,
    group = false,
  ) {
    if (
      admin &&
      (!groupAllowed(i) || i.policy?.role !== "admin" || !mfaValid(i))
    )
      fail("forbidden", 403);
    const p = await c.query(
      `select p.* from user_policy p join "user" u on u.id=p.user_id left join admission a on a.email=lower(u.email) where p.user_id=$1 and p.status<>'deleting' ${admin ? "and p.role='admin'" : ""} ${admin || group ? "and p.status='active' and p.admitted and a.active and p.accepted_at is not null and p.terms_version is not null" : ""} for share of p`,
      [i.user.id],
    );
    if (!p.rowCount) fail("forbidden", 403);
    if (admin || group) {
      const admission = await c.query(
        "select email from admission where email=$1 and active for share",
        [i.user.email.toLowerCase()],
      );
      if (!admission.rowCount) fail("forbidden", 403);
    }
    if (admin) {
      const session = await c.query(
        `update session_security set admin_used_at=now() where session_id=$1 and mfa_at>now()-interval '8 hours' and admin_used_at>now()-interval '15 minutes' returning session_id`,
        [i.session.id],
      );
      if (!session.rowCount) fail("forbidden", 403);
    }
  }
  private async audit(
    c: PoolClient,
    i: Identity,
    target: string,
    action: string,
    motif: string,
    reportId: string | null = null,
  ) {
    await c.query(
      "insert into moderation_audit(id,actor,target,action,reason,report_id) values($1,$2,$3,$4,$5,$6)",
      [randomUUID(), i.user.id, target, action, motif, reportId],
    );
  }
  async report(i: Identity, encounterId: string, input: unknown) {
    if (!groupAllowed(i) || !uuid(encounterId)) fail("forbidden", 403);
    const motif = reason(input);
    return this.transaction(async (c) => {
      await this.policy(c, i, false, true);
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,5))", [
        i.user.id,
      ]);
      const allowed = await c.query(
        `select e.id from encounter e join media m on m.id=e.media_id join user_policy p on p.user_id=e.owner_id join "user" u on u.id=p.user_id join admission a on a.email=lower(u.email) where e.id=$1 and e.visibility='public' and not e.hidden and e.deleted_at is null and m.state='ready' and p.status='active' and p.admitted and a.active and p.accepted_at is not null and p.terms_version is not null for share of e,p,a`,
        [encounterId],
      );
      if (!allowed.rowCount) fail("not_found", 404);
      const existing = (
        await c.query(
          "select id from report where reporter_id=$1 and encounter_id=$2 and closed_at is null",
          [i.user.id, encounterId],
        )
      ).rows[0];
      if (existing) return existing;
      const count = (
        await c.query(
          `select count(*) filter(where created_at>now()-interval '1 hour')::int hourly,count(*)::int daily from report where reporter_id=$1 and created_at>now()-interval '24 hours'`,
          [i.user.id],
        )
      ).rows[0];
      if (count.hourly >= 5 || count.daily >= 20)
        throw new EncounterError("limited", 429, 3600);
      const id = randomUUID();
      await c.query(
        "insert into report(id,encounter_id,reporter_id,reason) values($1,$2,$3,$4)",
        [id, encounterId, i.user.id, motif],
      );
      return { id };
    });
  }
  async reports(i: Identity, after?: string) {
    if (after && !uuid(after)) fail("invalid_request");
    return this.transaction(async (c) => {
      await this.policy(c, i, true);
      return (
        await c.query(
          `select id,encounter_id,reason,created_at,closed_at,outcome from report where ($1::text is null or id>$1) order by id limit 51`,
          [after ?? null],
        )
      ).rows;
    });
  }
  async consult(i: Identity, id: string, input: unknown) {
    const motif = reason(input);
    return this.transaction(async (c) => {
      await this.policy(c, i, true);
      const r = (
        await c.query(
          "select r.id,e.id as encounter_id,e.title,e.description,e.encounter_date,e.visibility,e.hidden,e.media_id,p.handle from report r join encounter e on e.id=r.encounter_id left join profile p on p.user_id=e.owner_id where r.id=$1 and r.closed_at is null and e.deleted_at is null for share of r,e",
          [id],
        )
      ).rows[0];
      if (!r) fail("not_found", 404);
      const grant = randomUUID();
      await c.query(
        "insert into report_consultation(id,report_id,session_id,actor,reason,expires_at) values($1,$2,$3,$4,$5,now()+interval '5 minutes')",
        [grant, id, i.session.id, i.user.id, motif],
      );
      await this.audit(c, i, r.encounter_id, "report_consulted", motif, id);
      return {
        ...r,
        media_id: undefined,
        image: `/api/v1/admin/reports/${id}/image?consultation=${grant}`,
      };
    });
  }
  async image(i: Identity, id: string, grant: string) {
    return this.transaction(async (c) => {
      await this.policy(c, i, true);
      const r = (
        await c.query(
          `select e.media_id,r.encounter_id,g.reason from report_consultation g join report r on r.id=g.report_id join encounter e on e.id=r.encounter_id join media m on m.id=e.media_id where g.id=$1 and r.id=$2 and g.actor=$3 and g.session_id=$4 and g.expires_at>now() and r.closed_at is null and e.deleted_at is null and m.state='ready' for share of e,r,m`,
          [grant, id, i.user.id, i.session.id],
        )
      ).rows[0];
      if (!r) fail("not_found", 404);
      await this.audit(
        c,
        i,
        r.encounter_id,
        "report_image_consulted",
        r.reason,
        id,
      );
      return this.storage.get(r.media_id + "/image.webp");
    });
  }
  async moderate(i: Identity, id: string, action: unknown, input: unknown) {
    const motif = reason(input);
    if (!["hide", "restore", "close"].includes(String(action)))
      fail("invalid_request");
    return this.transaction(async (c) => {
      await this.policy(c, i, true);
      const r = (
        await c.query(
          "select r.encounter_id,r.closed_at from report r where r.id=$1 for update",
          [id],
        )
      ).rows[0];
      if (!r) fail("not_found", 404);
      if (action === "close" && r.closed_at) return { status: true };
      if (action !== "close") {
        const changed = await c.query(
          "update encounter set hidden=$2,hidden_reason=$3,revision=revision+1,updated_at=now() where id=$1 and deleted_at is null returning id",
          [r.encounter_id, action === "hide", action === "hide" ? motif : null],
        );
        if (!changed.rowCount) fail("not_found", 404);
      }
      if (action === "close") {
        await c.query(
          "update report set closed_at=now(),outcome=$2 where id=$1",
          [id, motif],
        );
        await c.query("delete from report_consultation where report_id=$1", [
          id,
        ]);
      }
      await this.audit(c, i, r.encounter_id, String(action), motif, id);
      return { status: true };
    });
  }
  async members(i: Identity) {
    return this.transaction(async (c) => {
      await this.policy(c, i, true);
      return (
        await c.query(
          "select p.user_id,p.status,p.reason,p.role,f.handle,f.display_name from user_policy p left join profile f on f.user_id=p.user_id order by p.user_id limit 100",
        )
      ).rows;
    });
  }
  async suspend(i: Identity, target: string, action: unknown, input: unknown) {
    const motif = reason(input);
    if (
      !["suspend", "reactivate"].includes(String(action)) ||
      target === i.user.id
    )
      fail("invalid_request");
    return this.transaction(async (c) => {
      await this.policy(c, i, true);
      const r = await c.query(
        "update user_policy set status=$2,reason=$3,updated_at=now() where user_id=$1 and status in ('active','suspended') returning user_id",
        [
          target,
          action === "suspend" ? "suspended" : "active",
          action === "suspend" ? motif : null,
        ],
      );
      if (!r.rowCount) fail("not_found", 404);
      await c.query("delete from report_consultation where actor=$1", [target]);
      await this.audit(c, i, target, String(action), motif);
      return { status: true };
    });
  }
  async history(i: Identity, after?: string) {
    if (after && !uuid(after)) fail("invalid_request");
    return this.transaction(async (c) => {
      await this.policy(c, i, true);
      return (
        await c.query(
          "select * from moderation_audit where ($1::text is null or id>$1) order by id limit 51",
          [after ?? null],
        )
      ).rows;
    });
  }
  async requestExport(i: Identity) {
    if (!sensitiveAllowed(i)) fail("forbidden", 403);
    return this.transaction(async (c) => {
      await this.policy(c, i);
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,6))", [
        i.user.id,
      ]);
      const old = (
        await c.query(
          "select id,state from data_export where owner_id=$1 and (state='pending' or expires_at>now()) order by created_at desc limit 1",
          [i.user.id],
        )
      ).rows[0];
      if (old) return old;
      const quota = (
        await c.query(
          "select count(*)::int n from data_export where owner_id=$1 and created_at>now()-interval '24 hours'",
          [i.user.id],
        )
      ).rows[0];
      if (quota.n >= 3) throw new EncounterError("limited", 429, 86400);
      const id = randomUUID();
      await c.query("insert into data_export(id,owner_id) values($1,$2)", [
        id,
        i.user.id,
      ]);
      return { id, state: "pending" };
    });
  }
  async exports(i: Identity) {
    return this.transaction(async (c) => {
      await this.policy(c, i);
      return (
        await c.query(
          "select id,state,created_at,generated_at,expires_at,error from data_export where owner_id=$1 order by created_at desc limit 20",
          [i.user.id],
        )
      ).rows;
    });
  }
  async download(i: Identity, id: string) {
    if (!sensitiveAllowed(i)) fail("forbidden", 403);
    return this.transaction(async (c) => {
      await this.policy(c, i);
      const job = (
        await c.query(
          "select archive from data_export where id=$1 and owner_id=$2 and state='ready' and expires_at>now() for share",
          [id, i.user.id],
        )
      ).rows[0];
      if (!job) fail("not_found", 404);
      return job.archive as Buffer;
    });
  }
  async deletion(i: Identity, confirmation: unknown) {
    if (!sensitiveAllowed(i)) fail("forbidden", 403);
    if (confirmation !== "SUPPRIMER") fail("invalid_request");
    return this.transaction(async (c) => {
      // Same lock as media processing; a running upload completes before revocation.
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,3))", [
        i.user.id,
      ]);
      await this.policy(c, i);
      await this.queueDeletion(c, i.user.id);
      return { status: true };
    });
  }
  private async queueDeletion(c: PoolClient, ownerId: string) {
    await c.query("select pg_advisory_xact_lock(hashtextextended($1,7))", [
      ownerId,
    ]);
    await c.query(
      "update user_policy set status='deleting',reason=null,updated_at=now() where user_id=$1",
      [ownerId],
    );
    await c.query(
      "insert into account_deletion(owner_id) values($1) on conflict do nothing",
      [ownerId],
    );
    await c.query("delete from friendship where low_id=$1 or high_id=$1", [
      ownerId,
    ]);
    await c.query("delete from friend_attempt where owner_id=$1", [ownerId]);
    await c.query("delete from data_export where owner_id=$1", [ownerId]);
    await c.query("delete from report_consultation where actor=$1", [ownerId]);
    await c.query("delete from session where user_id=$1", [ownerId]);
    await c.query("delete from account where user_id=$1", [ownerId]);
    await c.query("delete from two_factor where user_id=$1", [ownerId]);
    await c.query("delete from verification where value=$1", [ownerId]);
    await c.query(
      'delete from admission where email=(select lower(email) from "user" where id=$1)',
      [ownerId],
    );
    await c.query(
      "update encounter set deleted_at=coalesce(deleted_at,now()),title='Souvenir supprimé',description='',hidden_reason=null,location_context=null,location_size=null,location_x=null,location_y=null where owner_id=$1",
      [ownerId],
    );
    await c.query(
      "update media set state='deleting',next_attempt_at=now() where owner_id=$1 and state<>'deleted'",
      [ownerId],
    );
  }
  private async inactive(ownerId: string) {
    return this.transaction(async (c) => {
      const lock = (
        await c.query(
          "select pg_try_advisory_xact_lock(hashtextextended($1,3)) ok",
          [ownerId],
        )
      ).rows[0];
      if (!lock.ok) return;
      const eligibility = `select a.*,u.email,(a.warned_at<=now()-interval '30 days' and a.last_used_at<=a.warned_at) due from account_activity a join "user" u on u.id=a.owner_id join user_policy p on p.user_id=a.owner_id where a.owner_id=$1 and a.last_used_at<=now()-interval '24 months' and p.status<>'deleting'`;
      // This scan is only a candidate check, not the deletion decision. A return
      // can update activity here; re-read under the shared activity lock below.
      if (!(await c.query(eligibility, [ownerId])).rowCount) return;
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,7))", [
        ownerId,
      ]);
      const account = (
        await c.query(eligibility + " for update of a", [ownerId])
      ).rows[0];
      if (!account) return;
      if (account.due) {
        await this.queueDeletion(c, ownerId);
        return;
      }
      if (
        account.warned_at ||
        !this.sendInactivity ||
        account.next_warning_at > new Date()
      )
        return;
      await c.query(
        "update account_activity set next_warning_at=now()+interval '1 hour' where owner_id=$1",
        [ownerId],
      );
      const key =
        "inactivity/" +
        createHash("sha256")
          .update(ownerId + ":" + account.last_used_at.toISOString())
          .digest("hex");
      try {
        await this.sendInactivity(account.email, key);
      } catch {
        // No deadline begins without provider acceptance; durable retry on next pass.
        return;
      }
      await c.query(
        "update account_activity set warned_at=clock_timestamp() where owner_id=$1",
        [ownerId],
      );
    });
  }
  async maintenance() {
    // Include accounts predating this lot and accounts never entering the portal.
    await this.pool.query(
      `insert into account_activity(owner_id,last_used_at) select u.id,now() from "user" u join user_policy p on p.user_id=u.id where p.status<>'deleting' on conflict(owner_id) do nothing`,
    );
    const inactive = (
      await this.pool.query(
        `select a.owner_id from account_activity a join user_policy p on p.user_id=a.owner_id where p.status<>'deleting' and a.last_used_at<=now()-interval '24 months' and (($1::boolean and a.warned_at is null and a.next_warning_at<=now()) or a.warned_at<=now()-interval '30 days') order by a.last_used_at limit 5`,
        [Boolean(this.sendInactivity)],
      )
    ).rows;
    for (const account of inactive) await this.inactive(account.owner_id);
    await this.pool.query(
      "delete from report_consultation where expires_at<=now()",
    );
    await this.pool.query(
      "delete from report where closed_at<now()-interval '6 months'",
    );
    await this.pool.query(
      "delete from moderation_audit where created_at<now()-interval '6 months'",
    );
    await this.pool.query(
      "delete from data_export where expires_at<=now() or (state='failed' and created_at<now()-interval '6 months')",
    );
    await this.pool.query(
      "delete from account_deletion where completed_at<now()-interval '30 days'",
    );
    const jobs = (
      await this.pool.query(
        "select id,owner_id from data_export where state='pending' and next_attempt_at<=now() order by created_at limit 5",
      )
    ).rows;
    for (const job of jobs)
      try {
        await this.generate(job.id, job.owner_id);
      } catch (e) {
        await this.pool.query(
          "update data_export set attempts=attempts+1,state=case when attempts>=2 then 'failed' else 'pending' end,error=$2,next_attempt_at=now()+interval '5 minutes' where id=$1 and state='pending'",
          [job.id, e instanceof EncounterError ? e.code : "export_unavailable"],
        );
      }
    const deletions = (
      await this.pool.query(
        "select owner_id from account_deletion where completed_at is null and next_attempt_at<=now() order by requested_at limit 5",
      )
    ).rows;
    for (const job of deletions)
      try {
        await this.purge(job.owner_id);
      } catch {
        await this.pool.query(
          "update account_deletion set attempts=attempts+1,next_attempt_at=now()+least(attempts+1,60)*interval '1 minute' where owner_id=$1",
          [job.owner_id],
        );
      }
  }
  private async generate(id: string, ownerId: string) {
    return this.transaction(async (c) => {
      const lock = (
        await c.query(
          "select pg_try_advisory_xact_lock(hashtextextended($1,3)) ok",
          [ownerId],
        )
      ).rows[0];
      if (!lock.ok) return;
      const job = (
        await c.query(
          "select id from data_export where id=$1 and state='pending' for update skip locked",
          [id],
        )
      ).rows[0];
      if (!job) return;
      const policy = (
        await c.query(
          "select * from user_policy where user_id=$1 and status<>'deleting' for share",
          [ownerId],
        )
      ).rows[0];
      if (!policy) {
        await c.query("delete from data_export where id=$1", [id]);
        return;
      }
      const reference = (
        await c.query("select now() as date")
      ).rows[0].date.toISOString();
      const data: Record<string, Record<string, unknown>[]> = {};
      // The repeatable snapshot preserves encounter metadata during edits/moderation.
      // The owner lock blocks physical media purges until the archive commits.
      // Explicit column projections: authentication material must never enter archives.
      const selections: Record<string, string> = {
        friends:
          "select f.handle as peer_handle,case when s.sender_id=$1 then 'sent' else 'received' end as request_direction,s.created_at,s.accepted_at from friendship s left join profile f on f.user_id=case when s.low_id=$1 then s.high_id else s.low_id end where (s.low_id=$1 or s.high_id=$1) and s.state='accepted' order by s.id",
        friend_requests:
          "select f.handle as peer_handle,case when s.sender_id=$1 then 'sent' else 'received' end as direction,s.created_at from friendship s left join profile f on f.user_id=case when s.low_id=$1 then s.high_id else s.low_id end where (s.low_id=$1 or s.high_id=$1) and s.state='pending' order by s.id",
        friend_attempts:
          "select created_at from friend_attempt where owner_id=$1 order by created_at",

        profile:
          'select id,name,email,email_verified,image,two_factor_enabled,created_at,updated_at from "user" where id=$1',
        customization:
          "select handle,display_name,bio,color,avatar from profile where user_id=$1",
        policy:
          "select status,role,reason,accepted_at,terms_version,admitted,updated_at from user_policy where user_id=$1",
        activity:
          "select last_used_at,warned_at,next_warning_at from account_activity where owner_id=$1",
        linked_accounts:
          "select provider_id,account_id,created_at,updated_at from account where user_id=$1",
        sessions:
          "select id,created_at,updated_at,expires_at,ip_address,user_agent from session where user_id=$1",
        session_security:
          "select authenticated_at,used_at,reauthenticated_at,mfa_at,admin_used_at from session_security where session_id in(select id from session where user_id=$1)",
        encounters:
          "select id,title,description,encounter_date,published_at,updated_at,visibility,hidden,hidden_reason,location_size,location_x,location_y,location_context,media_id from encounter where owner_id=$1 and deleted_at is null order by id",
        media:
          "select id,state,bytes,width,height,created_at,expires_at,error from media where owner_id=$1 and state not in ('deleting','deleted') order by id",
        uploads:
          "select bytes,created_at from upload_attempt where owner_id=$1",
        mail: 'select type,result,created_at from mail_attempt where recipient=(select email from "user" where id=$1)',
        reports_sent:
          "select id,encounter_id,reason,created_at,closed_at,outcome from report where reporter_id=$1",
        decisions:
          "select target,action,reason,created_at from moderation_audit where target=$1 or target in(select id from encounter where owner_id=$1)",
      };
      for (const [name, query] of Object.entries(selections))
        data[name] = (await c.query(query, [ownerId])).rows;
      const files: Array<{ name: string; bytes: Buffer }> = [];
      let size = 0;
      for (const media of data.media) {
        if (media.state !== "ready") continue;
        for (const variant of ["image", "thumb"]) {
          const name = `photos/${media.id}-${variant}.webp`,
            bytes = await this.storage.get(`${media.id}/${variant}.webp`);
          size += bytes.length;
          if (size > 100 * 1024 * 1024) fail("export_capacity", 413);
          files.push({ name, bytes });
        }
        media.files = [
          `photos/${media.id}-image.webp`,
          `photos/${media.id}-thumb.webp`,
        ];
      }
      const add = (name: string, text: string) =>
        files.push({ name, bytes: Buffer.from(text) });
      const complements = [
        "Données de tiers et signalements reçus : examen manuel nécessaire.",
        "Événements de sécurité et compteurs anti-abus : complément sécurisé sur demande.",
        "Messages externes de support et données des fournisseurs : complément après inventaire.",
        "Favoris du catalogue : conservés seulement dans ce navigateur.",
        "Avatars externes : seule la source enregistrée est fournie ; demander un complément pour le fichier fournisseur.",
        "Originaux photo déjà purgés : absents ; aucune reconstitution.",
      ];
      add(
        "data.json",
        JSON.stringify({ version: 1, reference, data, complements }, null, 2),
      );
      for (const [name, rows] of Object.entries(data))
        add("tables/" + name + ".csv", csv(rows));
      add(
        "README.txt",
        "Copie des données Miaou Club.\nRéférence UTC : " +
          reference +
          "\nJSON UTF-8 : valeurs de référence. CSV UTF-8 avec BOM, séparateur point-virgule, formules neutralisées. Photos WebP, image et miniature sans originaux.\n" +
          complements.join("\n") +
          "\nPour un complément de droit d’accès, contacter Gabriel par le canal connu. Le téléchargement ne supprime pas le compte.",
      );
      add(
        "informations-traitement.txt",
        "Copie technique des données de votre compte. Les informations juridiques et la notice ne sont pas encore finalisées : cette archive ne remplace pas une réponse complète au droit d’accès. Consultez Gabriel pour les destinataires, transferts, sources, durées et les données complémentaires.",
      );
      const manifest = {
        version: 1,
        request: id,
        reference,
        files: files.map((f) => ({ name: f.name, bytes: f.bytes.length })),
        records: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v.length]),
        ),
      };
      add("manifest.json", JSON.stringify(manifest, null, 2));
      const archive = zip(files);
      if (archive.length > 110 * 1024 * 1024) fail("export_capacity", 413);
      await c.query(
        "update data_export set state='ready',archive=$2,manifest=$3,generated_at=now(),expires_at=now()+interval '24 hours',error=null where id=$1",
        [id, archive, manifest],
      );
    }, true);
  }
  private async purge(ownerId: string) {
    return this.transaction(async (c) => {
      const lock = (
        await c.query(
          "select pg_try_advisory_xact_lock(hashtextextended($1,3)) ok",
          [ownerId],
        )
      ).rows[0];
      if (!lock.ok) return;
      const job = (
        await c.query(
          "select owner_id from account_deletion where owner_id=$1 and completed_at is null for update skip locked",
          [ownerId],
        )
      ).rows[0];
      if (!job) return;
      const policy = (
        await c.query(
          "select user_id from user_policy where user_id=$1 and status='deleting' for update",
          [ownerId],
        )
      ).rows[0];
      if (!policy) fail("deletion_state", 409);
      const media = (
        await c.query("select id from media where owner_id=$1", [ownerId])
      ).rows;
      for (const row of media) await this.storage.remove(objectKeys(row.id));
      await c.query(
        "delete from report_consultation where report_id in(select id from report where reporter_id=$1 or encounter_id in(select id from encounter where owner_id=$1))",
        [ownerId],
      );
      await c.query(
        "delete from report where reporter_id=$1 or encounter_id in(select id from encounter where owner_id=$1)",
        [ownerId],
      );
      await c.query("delete from encounter where owner_id=$1", [ownerId]);
      await c.query("delete from media where owner_id=$1", [ownerId]);
      await c.query("delete from upload_attempt where owner_id=$1", [ownerId]);
      await c.query("delete from data_export where owner_id=$1", [ownerId]);
      await c.query(
        'delete from mail_attempt where recipient=(select email from "user" where id=$1)',
        [ownerId],
      );
      await c.query("delete from account_activity where owner_id=$1", [
        ownerId,
      ]);
      await c.query('delete from "user" where id=$1', [ownerId]);
      await c.query(
        "update account_deletion set completed_at=now() where owner_id=$1",
        [ownerId],
      );
    });
  }
}
