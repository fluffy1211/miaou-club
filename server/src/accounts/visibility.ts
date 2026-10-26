// Single source of the rules deciding what other members may see.
// Fragments expect the aliases `p` (user_policy), `a` (admission),
// `e` (encounter) and `m` (media) in the surrounding query.

/** Member is active, admitted, has accepted the current charter and keeps an active admission. */
export const visibleMember = `(p.status='active' and p.admitted and p.accepted_at is not null and p.terms_version is not null and a.active)`;

/** Encounter is published, ready and shared with the club. Combine with `visibleMember` for its owner. */
export const publicEncounter = `(e.deleted_at is null and m.state='ready' and e.visibility='public' and not e.hidden)`;
