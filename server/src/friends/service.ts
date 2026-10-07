import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { groupAllowed, type Identity } from "../accounts/security.js";
import { EncounterError, uuid } from "../encounters/service.js";
const fail = (code: string, status = 400, retryAfter?: number): never => {
  throw new EncounterError(code, status, retryAfter);
};
const handleValid = (h: string) => /^[a-z0-9_]{3,30}$/.test(h);
// Shared projection: no auth ID, e-mail, social list or private encounters.
const members = `from profile f join "user" u on u.id=f.user_id join user_policy p on p.user_id=u.id join admission a on a.email=lower(u.email)`;
const visible = `p.status='active' and p.admitted and p.accepted_at is not null and p.terms_version is not null and a.active`;
export class Friends {
  constructor(private pool: Pool) {}
  private async transaction<T>(i: Identity, fn: (c: PoolClient) => Promise<T>) {
    if (!groupAllowed(i)) fail("forbidden", 403);
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      // Recheck actor in this transaction; status changes serialize on policy.
      if (
        !(
          await c.query(
            `select u.id ${members} where u.id=$1 and ${visible} for share of p,a`,
            [i.user.id],
          )
        ).rowCount
      )
        fail("forbidden", 403);
      const result = await fn(c);
      await c.query("commit");
      return result;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  async search(i: Identity, query: string, after = "") {
    const q = query.trim().toLowerCase();
    if (!handleValid(q) || (after && !handleValid(after)))
      fail("invalid_request");
    return this.transaction(i, async (c) => {
      const rows = (
        await c.query(
          `select f.handle,f.display_name as "displayName",f.color,f.avatar ${members} where ${visible} and u.id<>$1 and position($2 in f.handle)>0 and f.handle>$3 order by f.handle limit 31`,
          [i.user.id, q, after],
        )
      ).rows;
      return {
        people: rows.slice(0, 30),
        next: rows.length > 30 ? rows[29].handle : null,
      };
    });
  }
  async list(i: Identity, kind: string, after = "") {
    if (
      !["received", "sent", "friends"].includes(kind) ||
      (after && !uuid(after))
    )
      fail("invalid_request");
    return this.transaction(i, async (c) => {
      const condition =
        kind === "friends"
          ? `s.state='accepted'`
          : `s.state='pending' and s.sender_id${kind === "sent" ? "=" : "<>"}$1`;
      // Keep removal/refusal available when a peer is suspended or withdrawn,
      // without revealing that account's profile or status to another member.
      const rows = (
        await c.query(
          `select s.id,case when ${visible} then f.handle else null end as handle,case when ${visible} then f.display_name else 'Membre indisponible' end as "displayName",case when ${visible} then f.color else 'violet' end as color,case when ${visible} then f.avatar else 'initials' end as avatar,coalesce(${visible},false) as available,s.created_at as "createdAt",s.accepted_at as "acceptedAt" from friendship s join "user" u on u.id=case when s.low_id=$1 then s.high_id else s.low_id end join user_policy p on p.user_id=u.id left join profile f on f.user_id=u.id left join admission a on a.email=lower(u.email) where (s.low_id=$1 or s.high_id=$1) and ${condition} and ($2::uuid is null or s.id>$2::uuid) order by s.id limit 31`,
          [i.user.id, after || null],
        )
      ).rows;
      return {
        people: rows.slice(0, 30),
        next: rows.length > 30 ? rows[29].id : null,
      };
    });
  }
  async request(i: Identity, handle: string) {
    if (!handleValid(handle)) fail("invalid_request");
    return this.transaction(i, async (c) => {
      const target = (
        await c.query(
          `select u.id ${members} where f.handle=$1 and u.id<>$2 and ${visible} for share of p,a`,
          [handle, i.user.id],
        )
      ).rows[0];
      if (!target) fail("not_found", 404);
      const [low, high] = [i.user.id, target.id as string].sort();
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,12))", [
        JSON.stringify([low, high]),
      ]);
      const existing = (
        await c.query(
          "select id,state,sender_id from friendship where low_id=$1 and high_id=$2",
          [low, high],
        )
      ).rows[0];
      // Crossed requests return the existing received request: only explicit acceptance creates a friendship.
      if (existing)
        return {
          id: existing.id,
          state: existing.state,
          direction: existing.sender_id === i.user.id ? "sent" : "received",
        };
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,11))", [
        i.user.id,
      ]);
      const times = (
        await c.query(
          "select extract(epoch from created_at)*1000 as time,extract(epoch from now())*1000 as now from friend_attempt where owner_id=$1 and created_at>now()-interval '24 hours' order by created_at",
          [i.user.id],
        )
      ).rows;
      let retryAfter = 0;
      for (const [window, max] of [
        [3600000, 10],
        [86400000, 30],
      ]) {
        const matching = times.filter(
          (t) => Number(t.now) - Number(t.time) < window,
        );
        if (matching.length >= max) {
          const firstToExpire = matching[matching.length - max];
          retryAfter = Math.max(
            retryAfter,
            Math.ceil(
              (Number(firstToExpire.time) +
                window -
                Number(firstToExpire.now)) /
                1000,
            ),
            1,
          );
        }
      }
      if (retryAfter) fail("friend_limited", 429, retryAfter);
      await c.query("insert into friend_attempt(owner_id,id) values($1,$2)", [
        i.user.id,
        randomUUID(),
      ]);
      const id = randomUUID();
      await c.query(
        "insert into friendship(id,low_id,high_id,sender_id) values($1,$2,$3,$4)",
        [id, low, high, i.user.id],
      );
      return { id, state: "pending", direction: "sent" };
    });
  }
  async act(i: Identity, id: string, action: string) {
    if (!["accept", "refuse", "cancel", "remove"].includes(action))
      fail("invalid_request");
    return this.transaction(i, async (c) => {
      // Look up pair first, then serialize every mutation using the same pair lock.
      const pair = (
        await c.query(
          "select low_id,high_id,sender_id from friendship where id=$1 and (low_id=$2 or high_id=$2)",
          [id, i.user.id],
        )
      ).rows[0];
      if (!pair) fail("not_found", 404);
      if (
        action === "accept" &&
        !(
          await c.query(
            `select u.id ${members} where u.id=$1 and ${visible} for share of p,a`,
            [pair.sender_id],
          )
        ).rowCount
      )
        fail("not_found", 404);
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,12))", [
        JSON.stringify([pair.low_id, pair.high_id]),
      ]);
      const row = (
        await c.query("select * from friendship where id=$1 for update", [id])
      ).rows[0];
      if (!row) fail("not_found", 404);
      if (action === "accept") {
        if (row.sender_id === i.user.id) fail("forbidden", 403);

        if (row.state === "pending")
          await c.query(
            "update friendship set state='accepted',accepted_at=now() where id=$1",
            [id],
          );
      } else {
        const permitted =
          action === "remove"
            ? row.state === "accepted"
            : row.state === "pending" &&
              (action === "cancel"
                ? row.sender_id === i.user.id
                : row.sender_id !== i.user.id);
        if (!permitted) fail("forbidden", 403);
        await c.query("delete from friendship where id=$1", [id]);
      }
      return { status: true };
    });
  }
}
