import { randomUUID, createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { Identity } from "../accounts/security.js";
import { groupAllowed } from "../accounts/security.js";
import type { ObjectStorage } from "./storage.js";
import { objectKeys } from "./storage.js";
import { optimize, MAX_BYTES, InvalidPhoto } from "./pipeline.js";
export class EncounterError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
const fail = (code: string, status = 400, retryAfter?: number): never => {
  throw new EncounterError(code, status, retryAfter);
};
export type Draft = {
  title: string;
  description: string;
  encounterDate: string;
  visibility: "public" | "private";
};
export function draft(body: Record<string, unknown>): Draft {
  const {
    title,
    description = "",
    encounterDate,
    visibility = "public",
  } = body;
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 120 ||
    typeof description !== "string" ||
    description.length > 2000 ||
    typeof encounterDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(encounterDate) ||
    !Number.isFinite(Date.parse(encounterDate)) ||
    new Date(encounterDate).toISOString().slice(0, 10) !== encounterDate ||
    !["public", "private"].includes(String(visibility))
  )
    return fail("invalid_request");
  return {
    title: title.trim(),
    description: description.trim(),
    encounterDate,
    visibility: visibility as Draft["visibility"],
  };
}
export const uuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const joined = `from encounter e join media m on m.id=e.media_id join user_policy p on p.user_id=e.owner_id join "user" u on u.id=e.owner_id left join admission a on a.email=lower(u.email) left join profile f on f.user_id=e.owner_id`;
const permitted = `e.deleted_at is null and m.state='ready' and (e.owner_id=$1 or ($2 and e.visibility='public' and not e.hidden and p.status='active' and p.admitted and p.accepted_at is not null and p.terms_version is not null and a.active))`;
function project(row: QueryResultRow, ownerId: string) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    encounterDate: row.encounter_date,
    publishedAt: row.published_at,
    visibility: row.visibility,
    revision: row.revision,
    owned: row.owner_id === ownerId,
    author: row.display_name ?? "Membre",
    image: `/media/${row.media_id}/image`,
    thumbnail: `/media/${row.media_id}/thumb`,
    width: row.width,
    height: row.height,
    ...(row.owner_id === ownerId
      ? { hidden: row.hidden, hiddenReason: row.hidden_reason }
      : {}),
    location: null,
  };
}
export class Encounters {
  constructor(
    private pool: Pool,
    private storage: ObjectStorage,
  ) {}
  private async locked<T>(
    ownerId: string,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await this.pool.connect();
    let acquired = false;
    try {
      acquired = (
        await c.query(
          "select pg_try_advisory_lock(hashtextextended($1,3)) as ok",
          [ownerId],
        )
      ).rows[0].ok;
      if (!acquired) return fail("processing_busy", 429, 5);
      return await fn(c);
    } finally {
      let broken = false;
      try {
        if (acquired)
          await c.query("select pg_advisory_unlock(hashtextextended($1,3))", [
            ownerId,
          ]);
      } catch {
        broken = true;
      } finally {
        c.release(broken);
      }
    }
  }
  private async active(c: PoolClient, i: Identity) {
    const r = await c.query(
      `select p.user_id from user_policy p join "user" u on u.id=p.user_id join admission a on a.email=lower(u.email) where p.user_id=$1 and p.status='active' and p.admitted and p.accepted_at is not null and p.terms_version is not null and a.active for share of p,a`,
      [i.user.id],
    );
    if (!r.rowCount) fail("forbidden", 403);
  }
  async upload(i: Identity, request: Request) {
    return this.locked(i.user.id, async (c) => {
      await this.active(c, i);
      const receive = (
        await c.query("select pg_try_advisory_lock(739132014) as ok")
      ).rows[0].ok;
      if (!receive) return fail("processing_busy", 429, 5);
      try {
        const length = Number(request.headers.get("content-length"));
        if (length > MAX_BYTES) return fail("photo_size", 413);
        const reservation = length > 0 ? length : MAX_BYTES;
        const quota = await c.query(
          "select count(*) filter(where created_at>now()-interval '1 hour')::int as hourly,count(*)::int as daily,coalesce(sum(bytes),0)::bigint as bytes from upload_attempt where owner_id=$1 and created_at>now()-interval '24 hours'",
          [i.user.id],
        );
        const q = quota.rows[0];
        if (
          q.hourly >= 10 ||
          q.daily >= 30 ||
          Number(q.bytes) + reservation > 600000000
        )
          return fail("upload_limited", 429, 3600);
        const id = randomUUID();
        await c.query(
          "insert into upload_attempt(id,owner_id,bytes) values($1,$2,$3)",
          [id, i.user.id, reservation],
        );
        const chunks: Buffer[] = [];
        let size = 0;
        const reader = request.body?.getReader();
        if (!reader) return fail("photo_size");
        let timedOut = false;
        const deadline = setTimeout(() => {
          timedOut = true;
          void reader.cancel();
        }, 15000);
        try {
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            size += item.value.byteLength;
            if (size > MAX_BYTES || (length > 0 && size > length)) {
              await reader.cancel();
              return fail("photo_size", 413);
            }
            chunks.push(Buffer.from(item.value));
          }
        } finally {
          clearTimeout(deadline);
          await c.query("update upload_attempt set bytes=$2 where id=$1", [
            id,
            Math.min(size, MAX_BYTES),
          ]);
        }
        if (timedOut) return fail("upload_timeout", 408);
        if (!size || (length > 0 && size !== length)) return fail("photo_size");
        const bytes = Buffer.concat(chunks);
        // The durable row precedes every storage write, including uncertain network outcomes.
        await c.query(
          "insert into media(id,owner_id,bytes,expires_at) values($1,$2,$3,now()+interval '24 hours')",
          [id, i.user.id, size],
        );
        try {
          await this.storage.put(
            id + "/original",
            bytes,
            "application/octet-stream",
          );
          await c.query("update media set state='pending' where id=$1", [id]);
          await this.process(c, id);
        } catch (error) {
          await c.query(
            "update media set state='failed',error=$2,next_attempt_at=now()+interval '1 minute' where id=$1 and state not in ('ready','deleting','deleted')",
            [
              id,
              error instanceof InvalidPhoto
                ? error.code
                : "storage_unavailable",
            ],
          );
        }
        return this.media(i, id);
      } finally {
        await c.query("select pg_advisory_unlock(739132014)");
      }
    });
  }
  private async process(c: PoolClient, id: string) {
    const acquired = (
      await c.query("select pg_try_advisory_lock(739132013) as ok")
    ).rows[0].ok;
    if (!acquired) return;
    try {
      const r = await c.query(
        "update media set state='processing',attempts=attempts+1 where id=$1 and state in ('pending','processing','failed','uploading') and attempts<3 and expires_at>now() returning *",
        [id],
      );
      if (!r.rowCount) return;
      try {
        const data = await optimize(await this.storage.get(id + "/original"));
        await this.storage.put(id + "/image.webp", data.image, "image/webp");
        await this.storage.put(id + "/thumb.webp", data.thumb, "image/webp");
        await c.query(
          "update media set state='ready',width=$2,height=$3,error=null,next_attempt_at=now() where id=$1",
          [id, data.width, data.height],
        );
      } catch (error) {
        await c.query(
          "update media set state='failed',error=$2,next_attempt_at=now()+interval '1 minute' where id=$1",
          [
            id,
            error instanceof InvalidPhoto ? error.code : "storage_unavailable",
          ],
        );
      }
      await this.purgeOriginal(c, id);
    } finally {
      await c.query("select pg_advisory_unlock(739132013)");
    }
  }
  private async purgeOriginal(c: PoolClient, id: string) {
    const r = await c.query(
      "select state,original_present from media where id=$1",
      [id],
    );
    if (r.rows[0]?.state !== "ready" || !r.rows[0].original_present) return;
    try {
      await this.storage.remove([id + "/original"]);
      await c.query(
        "update media set original_present=false,purge_attempts=0 where id=$1",
        [id],
      );
    } catch {
      await c.query(
        "update media set purge_attempts=purge_attempts+1,next_attempt_at=now()+interval '1 minute' where id=$1",
        [id],
      );
    }
  }
  async media(i: Identity, id: string) {
    const r = await this.pool.query(
      "select * from media where id=$1 and owner_id=$2 and state not in ('deleting','deleted') and (expires_at>now() or exists(select 1 from encounter where media_id=media.id and deleted_at is null))",
      [id, i.user.id],
    );
    const m = r.rows[0];
    if (!m) return fail("not_found", 404);
    return {
      id: m.id,
      state: m.state,
      expiresAt: m.expires_at.toISOString(),
      width: m.width,
      height: m.height,
      error: m.error,
      image: m.state === "ready" ? `/media/${m.id}/image` : null,
    };
  }
  async retry(i: Identity, id: string) {
    await this.locked(i.user.id, async (c) => {
      await this.active(c, i);
      const r = await c.query(
        "select * from media where id=$1 and owner_id=$2",
        [id, i.user.id],
      );
      const m = r.rows[0];
      if (!m) return fail("not_found", 404);
      if (
        m.state !== "failed" ||
        m.attempts >= 3 ||
        new Date(m.expires_at) <= new Date()
      )
        return fail("retry_unavailable", 409);
      await this.process(c, id);
    });
    return this.media(i, id);
  }
  async list(i: Identity, after?: string) {
    const cursor = after && uuid(after) ? after : null;
    const r = await this.pool.query(
      `select e.*,e.encounter_date::text as encounter_date,m.width,m.height,f.display_name ${joined} where ${permitted} and e.owner_id=$1 and ($3::text is null or (e.published_at,e.id)<(select published_at,id from encounter where id=$3 and owner_id=$1)) order by e.published_at desc,e.id desc limit 31`,
      [i.user.id, groupAllowed(i), cursor],
    );
    return {
      encounters: r.rows.slice(0, 30).map((r) => project(r, i.user.id)),
      next: r.rows.length > 30 ? r.rows[29].id : null,
    };
  }
  async detail(i: Identity, id: string) {
    const r = await this.pool.query(
      `select e.*,e.encounter_date::text as encounter_date,m.width,m.height,f.display_name ${joined} where ${permitted} and e.id=$3`,
      [i.user.id, groupAllowed(i), id],
    );
    if (!r.rowCount) return fail("not_found", 404);
    return project(r.rows[0], i.user.id);
  }
  async image(i: Identity, id: string, variant: string) {
    // Unpublished preview belongs only to its owner and expires after 24 h.
    const r = await this.pool.query(
      `select m.id from media m left join encounter e on e.media_id=m.id left join user_policy p on p.user_id=m.owner_id left join "user" u on u.id=m.owner_id left join admission a on a.email=lower(u.email) where m.id=$3 and m.state='ready' and ((e.id is null and m.owner_id=$1 and m.expires_at>now()) or (e.id is not null and ${permitted}))`,
      [i.user.id, groupAllowed(i), id],
    );
    if (!r.rowCount) return fail("not_found", 404);
    try {
      return await this.storage.get(
        id + (variant === "thumb" ? "/thumb.webp" : "/image.webp"),
      );
    } catch {
      return fail("media_unavailable", 503);
    }
  }
  async publish(i: Identity, body: Record<string, unknown>, key: string) {
    if (
      !uuid(key) ||
      !uuid(body.mediaId) ||
      Object.keys(body).some(
        (k) =>
          ![
            "mediaId",
            "title",
            "description",
            "encounterDate",
            "visibility",
          ].includes(k),
      )
    )
      return fail("invalid_request");
    const d = draft(body),
      hash = createHash("sha256")
        .update(JSON.stringify({ ...d, mediaId: body.mediaId }))
        .digest("hex");
    const c = await this.pool.connect();
    let id: string;
    try {
      await c.query("begin");
      await this.active(c, i);
      // Serializes publication quota and duplicate keys across replicas.
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,3))", [
        i.user.id,
      ]);
      const old = (
        await c.query(
          "select * from encounter where owner_id=$1 and request_key=$2",
          [i.user.id, key],
        )
      ).rows[0];
      if (old) {
        if (old.fingerprint !== hash) fail("idempotency_conflict", 409);
        if (old.deleted_at) fail("gone", 410);
        id = old.id;
      } else {
        const m = (
          await c.query(
            "select * from media where id=$1 and owner_id=$2 for update",
            [body.mediaId, i.user.id],
          )
        ).rows[0];
        if (!m || m.state !== "ready" || new Date(m.expires_at) <= new Date())
          fail("media_not_ready", 409);
        if (
          (
            await c.query("select id from encounter where media_id=$1", [
              body.mediaId,
            ])
          ).rowCount
        )
          fail("media_used", 409);
        const count = (
          await c.query(
            "select count(*)::int as n from encounter where owner_id=$1 and published_at>now()-interval '24 hours'",
            [i.user.id],
          )
        ).rows[0].n;
        if (count >= 30) fail("publication_limited", 429, 86400);
        // Missing variant must never create a successful durable publication.
        await this.storage.get(String(body.mediaId) + "/image.webp");
        await this.storage.get(String(body.mediaId) + "/thumb.webp");
        id = randomUUID();
        await c.query(
          "insert into encounter(id,owner_id,media_id,request_key,fingerprint,title,description,encounter_date,visibility) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            id,
            i.user.id,
            body.mediaId,
            key,
            hash,
            d.title,
            d.description,
            d.encounterDate,
            d.visibility,
          ],
        );
      }
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
    return this.detail(i, id);
  }
  async edit(i: Identity, id: string, body: Record<string, unknown>) {
    if (
      Object.keys(body).some(
        (k) =>
          ![
            "title",
            "description",
            "encounterDate",
            "visibility",
            "revision",
          ].includes(k),
      ) ||
      !Number.isSafeInteger(body.revision)
    )
      return fail("invalid_request");
    const d = draft(body);
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await this.active(c, i);
      const r = await c.query(
        "update encounter set title=$3,description=$4,encounter_date=$5,visibility=$6,revision=revision+1,updated_at=now() where id=$1 and owner_id=$2 and deleted_at is null and revision=$7 returning id",
        [
          id,
          i.user.id,
          d.title,
          d.description,
          d.encounterDate,
          d.visibility,
          body.revision,
        ],
      );
      if (!r.rowCount) fail("edit_conflict", 409);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
    return this.detail(i, id);
  }
  async remove(i: Identity, id: string) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      const r = await c.query(
        "update encounter set deleted_at=coalesce(deleted_at,now()),title='Souvenir supprimé',description='',hidden_reason=null,encounter_date=current_date where id=$1 and owner_id=$2 returning media_id",
        [id, i.user.id],
      );
      if (!r.rowCount) fail("not_found", 404);
      await c.query(
        "update media set state='deleting',next_attempt_at=now() where id=$1 and state<>'deleted'",
        [r.rows[0].media_id],
      );
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  async abandon(i: Identity, id: string) {
    await this.locked(i.user.id, async (c) => {
      const r = await c.query(
        "update media set state='deleting',next_attempt_at=now() where id=$1 and owner_id=$2 and not exists(select 1 from encounter where media_id=$1) returning id",
        [id, i.user.id],
      );
      if (!r.rowCount) fail("not_found", 404);
    });
  }
  async maintenance() {
    const rows = await this.pool.query(
      "select id,owner_id from media where state not in ('deleted') and next_attempt_at<=now() and (state in ('uploading','pending','processing','deleting') or (state='failed' and error='storage_unavailable' and attempts<3) or original_present or (expires_at<=now() and not exists(select 1 from encounter where media_id=media.id and deleted_at is null))) order by next_attempt_at limit 20",
    );
    for (const row of rows.rows) {
      try {
        await this.locked(row.owner_id, async (c) => {
          // Expired unbound objects and any partial output are durable purge work.
          await c.query(
            "update media set state='deleting' where id=$1 and expires_at<=now() and not exists(select 1 from encounter where media_id=$1 and deleted_at is null)",
            [row.id],
          );
          const m = (await c.query("select * from media where id=$1", [row.id]))
            .rows[0];
          if (m.state === "deleting") {
            try {
              await this.storage.remove(objectKeys(row.id));
              await c.query(
                "update media set state='deleted',original_present=false,error=null where id=$1",
                [row.id],
              );
            } catch {
              await c.query(
                "update media set purge_attempts=purge_attempts+1,next_attempt_at=now()+least(purge_attempts+1,60)*interval '1 minute' where id=$1",
                [row.id],
              );
            }
          } else if (m.state === "ready") await this.purgeOriginal(c, row.id);
          else if (
            ["uploading", "pending", "processing"].includes(m.state) ||
            (m.state === "failed" &&
              m.error === "storage_unavailable" &&
              m.attempts < 3)
          )
            await this.process(c, row.id);
        });
      } catch (e) {
        if (!(e instanceof EncounterError && e.code === "processing_busy"))
          throw e;
      }
    }
    // Deleted publication keys remain only for the 7-day recovery window. The
    // media purge state outlives the tombstone if storage is still unavailable.
    await this.pool.query(
      "delete from encounter where deleted_at<now()-interval '7 days'",
    );
    await this.pool.query(
      "delete from media where state='deleted' and not exists(select 1 from encounter where media_id=media.id)",
    );
    await this.pool.query(
      "delete from upload_attempt where created_at<now()-interval '48 hours'",
    );
  }
}
