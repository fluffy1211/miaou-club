import { useEffect, useState, useRef } from "react";
import { encounterAPI, EncounterAPIError } from "./encounter-api";
type Person = {
  id?: string;
  handle: string | null;
  available?: boolean;
  displayName: string;
  color: string;
  avatar: string;
};
type Page = { people: Person[]; next: string | null };
type Kind = "received" | "sent" | "friends";
const errorMessage = (e: unknown) => {
  if (e instanceof EncounterAPIError && e.code === "not_found")
    return "Ce lien n’est plus disponible. Recharge la page pour retrouver tes demandes et tes amis.";
  if (e instanceof EncounterAPIError && e.code === "invalid_request")
    return "Vérifie le pseudo : 3 à 30 lettres, chiffres ou tirets bas.";
  return (e as Error).message;
};
const empty = (): Page => ({ people: [], next: null });
const headings: Record<Kind, string> = {
  received: "Demandes reçues",
  sent: "Demandes envoyées",
  friends: "Mes amis",
};
export function FriendsPanel({
  preview = false,
  initial = {},
  initialMessage = "",
}: {
  preview?: boolean;
  initial?: Partial<Record<Kind, Page>>;
  initialMessage?: string;
}) {
  const [pages, setPages] = useState<Record<Kind, Page>>({
    received: initial.received ?? empty(),
    sent: initial.sent ?? empty(),
    friends: initial.friends ?? empty(),
  });
  const [results, setResults] = useState<Page | null>(null),
    [query, setQuery] = useState(""),
    [searched, setSearched] = useState(""),
    [message, setMessage] = useState(initialMessage),
    [busy, setBusy] = useState(!preview),
    [loaded, setLoaded] = useState(Boolean(preview));
  const alive = useRef(true);
  async function reload() {
    const values = await Promise.all(
      (Object.keys(headings) as Kind[]).map(
        async (kind) =>
          [
            kind,
            await encounterAPI<Page>("/api/v1/me/friends?kind=" + kind),
          ] as const,
      ),
    );
    if (!alive.current) return;
    setPages(Object.fromEntries(values) as Record<Kind, Page>);
    setLoaded(true);
  }
  useEffect(() => {
    alive.current = true;
    // Jamais de clavier à l'ouverture : on ne focalise le champ qu'au toucher.
    if (document.activeElement instanceof HTMLInputElement)
      document.activeElement.blur();
    if (!preview)
      void (async () => {
        try {
          await reload();
          const q = new URLSearchParams(window.location.search).get("q") ?? "";
          if (/^[a-z0-9_]{3,30}$/.test(q)) {
            const found = await encounterAPI<Page>(
              "/api/v1/people?q=" + encodeURIComponent(q),
            );
            if (alive.current) {
              setQuery(q);
              setSearched(q);
              setResults(found);
            }
          }
        } catch (e) {
          if (alive.current) setMessage(errorMessage(e));
        } finally {
          if (alive.current) setBusy(false);
        }
      })();
    return () => {
      alive.current = false;
    };
  }, [preview]);
  async function run(fn: () => Promise<void>) {
    if (busy || preview) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setMessage(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function more(kind: Kind) {
    await run(async () => {
      const p = await encounterAPI<Page>(
        "/api/v1/me/friends?kind=" +
          kind +
          "&after=" +
          encodeURIComponent(pages[kind].next!),
      );
      if (alive.current)
        setPages((prev) => ({
          ...prev,
          [kind]: {
            people: [
              ...prev[kind].people,
              ...p.people.filter(
                (x) => !prev[kind].people.some((y) => x.id === y.id),
              ),
            ],
            next: p.next,
          },
        }));
    });
  }
  async function action(person: Person, verb: string) {
    await run(async () => {
      const url =
        verb === "request"
          ? "/api/v1/me/friends/requests/" + encodeURIComponent(person.handle!)
          : "/api/v1/me/friends/" + person.id + "/" + verb;
      const result = await encounterAPI<{ state?: string; direction?: string }>(
        url,
        { method: "POST" },
      );
      await reload();
      if (alive.current)
        setMessage(
          verb === "request"
            ? result.state === "accepted"
              ? "Cette personne est déjà dans tes amis."
              : result.direction === "received"
                ? "Cette personne t’a déjà envoyé une demande. Tu peux l’accepter dans les demandes reçues."
                : "Demande envoyée."
            : verb === "accept"
              ? "Vous êtes maintenant amis."
              : verb === "refuse"
                ? "Demande refusée."
                : verb === "cancel"
                  ? "Demande annulée."
                  : "Ami retiré.",
        );
    });
  }
  function row(p: Person, kind?: Kind) {
    return (
      <li className="friend-row" key={p.id ?? p.handle}>
        <span
          className={"friend-initial account-color-" + p.color}
          aria-hidden="true"
        >
          {p.avatar === "cat" ? "∧ ∧" : p.displayName.slice(0, 1)}
        </span>
        <div className="friend-person">
          {p.handle ? (
            <>
              <a href={"/profil/" + encodeURIComponent(p.handle)}>{p.handle}</a>
            </>
          ) : (
            <strong>{p.displayName}</strong>
          )}
        </div>
        <div className="friend-actions">
          {kind === "received" ? (
            <>
              <button
                className="button secondary"
                disabled={busy || preview || p.available === false}
                onClick={() => void action(p, "accept")}
              >
                Accepter
              </button>
              <button
                className="friend-text-action"
                disabled={busy || preview}
                onClick={() => void action(p, "refuse")}
              >
                Refuser
              </button>
            </>
          ) : (
            <button
              className={kind ? "friend-text-action" : "button secondary"}
              disabled={busy || preview}
              onClick={() =>
                void action(
                  p,
                  kind === "sent"
                    ? "cancel"
                    : kind === "friends"
                      ? "remove"
                      : "request",
                )
              }
            >
              {kind === "sent"
                ? "Annuler"
                : kind === "friends"
                  ? "Retirer"
                  : "Ajouter"}
            </button>
          )}
        </div>
      </li>
    );
  }
  return (
    <section className="friends-panel" aria-busy={busy}>
      <a className="back-link" href="/profil">
        Retour au profil
      </a>
      <h1>Les amis du club.</h1>
      <p>Ta liste reste personnelle.</p>
      <form
        className="friend-search"
        onSubmit={(e) => {
          e.preventDefault();
          // Easter egg: Figue, Gabriel's cat, is found by name.
          if (query.trim().toLowerCase() === "figue") {
            window.location.assign("/figue");
            return;
          }
          void run(async () => {
            const q = query.trim().toLowerCase();
            const found = await encounterAPI<Page>(
              "/api/v1/people?q=" + encodeURIComponent(q),
            );
            if (alive.current) {
              setSearched(q);
              setResults(found);
            }
          });
        }}
      >
        <label htmlFor="friend-query">Chercher un pseudo</label>
        <div>
          <input
            id="friend-query"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            minLength={3}
            maxLength={30}
            required
            pattern="[A-Za-z0-9_]{3,30}"
            placeholder="Pseudo…"
          />
          <button className="button secondary" disabled={busy || preview}>
            Chercher
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite" className="friend-message">
        {message || (busy ? "Chargement…" : "")}
      </p>
      {results && (
        <section className="friend-section">
          <h2>Résultats</h2>
          {results.people.length ? (
            <ul>{results.people.map((p) => row(p))}</ul>
          ) : (
            <p>Aucun membre trouvé avec ce pseudo.</p>
          )}
          {results.next && (
            <button
              className="button secondary"
              disabled={busy || preview}
              onClick={() =>
                void run(async () => {
                  const found = await encounterAPI<Page>(
                    "/api/v1/people?q=" +
                      encodeURIComponent(searched) +
                      "&after=" +
                      encodeURIComponent(results.next!),
                  );
                  if (alive.current)
                    setResults((prev) => ({
                      people: [...prev!.people, ...found.people],
                      next: found.next,
                    }));
                })
              }
            >
              Voir plus de résultats
            </button>
          )}
        </section>
      )}
      {loaded && !pages.received.people.length && !pages.sent.people.length && (
        <p className="friend-pending-empty">Aucune demande en attente.</p>
      )}
      {(Object.keys(headings) as Kind[])
        // Les demandes vides tiennent sur une seule ligne au-dessus.
        .filter((kind) => kind === "friends" || pages[kind].people.length > 0)
        .map((kind) => (
          <section className="friend-section" key={kind}>
            <h2>{headings[kind]}</h2>
            {pages[kind].people.length ? (
              <ul>{pages[kind].people.map((p) => row(p, kind))}</ul>
            ) : (
              <p>Ton cercle attend ses premiers amis.</p>
            )}
            {pages[kind].next && (
              <button
                className="button secondary"
                disabled={busy || preview}
                onClick={() => void more(kind)}
              >
                Voir plus — {headings[kind].toLowerCase()}
              </button>
            )}
          </section>
        ))}
    </section>
  );
}
