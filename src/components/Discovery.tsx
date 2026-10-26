import { useEffect, useState, useRef } from "react";
import type { EncounterView, LocationCell } from "@miaou/contracts";
import { encounterAPI, frenchDate } from "./encounter-api";
import { Polaroid } from "./Polaroid";
import { LazyZoneMap } from "./LazyZoneMap";
import { searchPlaces, type SearchPlace } from "../lib/map-provider";
import { locationLabel } from "./LocationFields";
type Page = { encounters: EncounterView[]; next: string | null };
type Profile = {
  handle: string;
  displayName: string;
  bio: string;
  color: string;
  avatar: string;
};
export function Discovery({
  mode = "home",
  handle,
  choose = false,
  providerKey,
}: {
  mode?: "home" | "list" | "map" | "profile";
  handle?: string;
  choose?: boolean;
  providerKey?: string;
}) {
  const [entries, setEntries] = useState<EncounterView[]>([]),
    [next, setNext] = useState<string | null>(null),
    [own, setOwn] = useState<EncounterView | null>(null),
    [owner, setOwner] = useState(""),
    [name, setName] = useState(""),
    [profile, setProfile] = useState<Profile | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(true),
    [ready, setReady] = useState(false),
    [selected, setSelected] = useState<LocationCell | null>(null),
    [focus, setFocus] = useState<LocationCell | null>(null);
  const [selectionSize, setSelectionSize] =
    useState<LocationCell["size"]>(1000);
  const [query, setQuery] = useState(""),
    [places, setPlaces] = useState<SearchPlace[]>([]),
    [searchBusy, setSearchBusy] = useState(false),
    [navigationCenter, setNavigationCenter] = useState<[number, number]>();
  const searchRequest = useRef<AbortController | null>(null);
  useEffect(() => () => searchRequest.current?.abort(), []);
  async function search() {
    if (!providerKey) return;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearchBusy(true);
    setMessage("");
    try {
      const results = await searchPlaces(query, providerKey, controller.signal);
      const { onMainland } =
        await import("../../server/src/encounters/location");
      if (!controller.signal.aborted) {
        const allowed = results.filter((p) =>
          onMainland(p.center[0], p.center[1]),
        );
        setPlaces(allowed);
        if (!allowed.length)
          setMessage("Aucune ville ou quartier trouvé dans le périmètre.");
      }
    } catch (e) {
      if (!controller.signal.aborted) setMessage((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setSearchBusy(false);
    }
  }
  const endpoint =
    mode === "map"
      ? "/api/v1/map"
      : handle
        ? "/api/v1/profiles/" + encodeURIComponent(handle) + "/encounters"
        : "/api/v1/encounters";
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const me = await encounterAPI<{
          access: string;
          user: { id: string };
          profile: Profile;
        }>("/api/v1/me");
        if (me.access !== "group") {
          window.location.assign("/profil");
          return;
        }
        const p = handle
          ? await encounterAPI<{ profile: Profile }>(
              "/api/v1/profiles/" + encodeURIComponent(handle),
            )
          : null;
        const page = await encounterAPI<Page>(endpoint);
        const notebook =
          mode === "home"
            ? await encounterAPI<Page>("/api/v1/me/encounters")
            : null;
        if (alive) {
          setReady(true);
          setOwner(me.user.id);
          setName(me.profile?.handle ?? me.profile?.displayName ?? "Membre");
          setProfile(p?.profile ?? null);
          setEntries(page.encounters);
          setNext(page.next);
          setOwn(notebook?.encounters[0] ?? null);
          const params = new URLSearchParams(window.location.search);
          if (params.has("zone")) {
            try {
              const { cell } =
                await import("../../server/src/encounters/location");
              if (!alive) return;
              setFocus(cell(JSON.parse(params.get("zone")!)));
            } catch {
              setMessage("Cette zone est invalide.");
            }
          }
        }
      } catch (e) {
        if (alive) setMessage((e as Error).message);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [endpoint, handle, mode]);
  async function more() {
    if (!next) return;
    setBusy(true);
    try {
      const p = await encounterAPI<Page>(
        endpoint + "?after=" + encodeURIComponent(next),
      );
      setEntries((old) => [
        ...old,
        ...p.encounters.filter((e) => !old.some((o) => o.id === e.id)),
      ]);
      setNext(p.next);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function card(e: EncounterView) {
    return (
      <article key={e.id} id={"zone-" + e.id}>
        <a href={"/rencontre/" + e.id}>
          <Polaroid small image={e.thumbnail} title={e.title} />
        </a>
        <p className="encounter-meta">
          {frenchDate(e.encounterDate)} · partagé par{" "}
          {e.authorHandle ? (
            <a href={"/profil/" + e.authorHandle}>{e.author}</a>
          ) : (
            e.author
          )}
        </p>
        {mode === "map" && <p>{locationLabel(e.location)}</p>}
      </article>
    );
  }
  return (
    <section aria-busy={busy}>
      {mode === "home" && name && <p>Bonjour {name}</p>}
      <h1>
        {mode === "home"
          ? "Les derniers mignons."
          : mode === "profile"
            ? (profile?.displayName ?? "Profil du club")
            : mode === "map"
              ? "Les chats du coin."
              : "Tous les mignons."}
      </h1>
      {profile && (
        <div className={"public-profile account-color-" + profile.color}>
          <a
            className="text-link"
            href={"/amis?q=" + encodeURIComponent(profile.handle)}
          >
            Retrouver ce membre dans mes amis
          </a>
          <div className="profile-initial" aria-hidden="true">
            {profile.avatar === "cat" ? (
              <svg viewBox="0 0 24 24">
                <path d="M4 13V3l5 4h6l5-4v10c0 5-4 8-8 8s-8-3-8-8Z" />
                <circle cx="9" cy="12" r="1" />
                <circle cx="15" cy="12" r="1" />
                <path d="m10 16 2 1 2-1" />
              </svg>
            ) : (
              profile.displayName.slice(0, 1)
            )}
          </div>
          <p>{profile.bio}</p>
        </div>
      )}
      <p role="status">{message || (busy ? "Chargement…" : "")}</p>
      <div className="encounter-actions">
        <a className="encounter-link" href="/rencontres">
          Les mignons
        </a>
        <a className="encounter-link" href="/carte">
          La carte
        </a>
        <a className="encounter-link" href="/photo">
          Ajouter une rencontre
        </a>
      </div>
      {mode === "map" && ready && (
        <>
          {providerKey && (
            <form
              className="map-search"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <label>
                Ville ou quartier
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  minLength={2}
                  maxLength={100}
                  disabled={!providerKey}
                  placeholder="Ville ou quartier"
                />
              </label>
              <button
                className="encounter-button secondary"
                disabled={!providerKey || searchBusy}
              >
                Chercher
              </button>
            </form>
          )}
          {places.length > 0 && (
            <ul>
              {places.map((p, n) => (
                <li key={n}>
                  <button
                    className="encounter-link"
                    onClick={() => {
                      setNavigationCenter(p.center);
                      setPlaces([]);
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <LazyZoneMap
            providerKey={providerKey}
            navigationCenter={navigationCenter}
            entries={entries}
            focus={focus}
            selected={selected}
            selectionSize={selectionSize}
            onSelect={choose ? setSelected : undefined}
          />
          {choose && (
            <section>
              <h2>Choisir un lieu</h2>
              <label>
                Taille de la zone à choisir
                <select
                  value={selectionSize}
                  onChange={(e) => {
                    setSelectionSize(
                      Number(e.target.value) as LocationCell["size"],
                    );
                    setSelected(null);
                  }}
                >
                  {[500, 1000, 2000].map((s) => (
                    <option key={s} value={s}>
                      {s} m
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Touche la carte pour proposer une cellule.{" "}
                {locationLabel(selected)}
              </p>
              {selected && (
                <button
                  className="encounter-button"
                  onClick={() => {
                    try {
                      sessionStorage.setItem(
                        "miaou-selected-cell-" + owner,
                        JSON.stringify(selected),
                      );
                      window.location.assign("/photo");
                    } catch {
                      setMessage(
                        "Le stockage de cet onglet est indisponible. Utilise ta position depuis le formulaire ou publie sans lieu.",
                      );
                    }
                  }}
                >
                  Utiliser cette zone
                </button>
              )}
              <a href="/photo">Revenir sans lieu</a>
            </section>
          )}
          <h2>Les rencontres de la carte</h2>
        </>
      )}
      <div
        className={
          "notebook-grid" + (mode === "home" ? " discovery-home-grid" : "")
        }
      >
        {entries.map(card)}
      </div>
      {!busy && !entries.length && !message && (
        <p>Aucune rencontre partagée pour le moment.</p>
      )}
      {next && (
        <button
          className="encounter-button secondary"
          disabled={busy}
          onClick={() => void more()}
        >
          Voir la suite
        </button>
      )}
      {mode === "home" && (
        <section className="home-notebook">
          <h2>{own ? "Ta dernière rencontre" : "Ton carnet"}</h2>
          {own ? (
            <>
              {card(own)}
              <a href="/carnet">Voir tout mon carnet</a>
            </>
          ) : (
            <p>
              Le prochain Polaroid, c’est le tien.{" "}
              <a href="/photo">Photographier un chat</a>
            </p>
          )}
        </section>
      )}
    </section>
  );
}
