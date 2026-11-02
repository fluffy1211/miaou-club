import { useEffect, useState, useRef } from "react";
import type { EncounterView, LocationCell } from "@miaou/contracts";
import { encounterAPI, frenchDate } from "./encounter-api";
import { Polaroid } from "./Polaroid";
import { LazyZoneMap } from "./LazyZoneMap";
import { searchPlaces, type SearchPlace } from "../lib/map-provider";
import { locationLabel } from "./LocationFields";
const noEntries: EncounterView[] = [];
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
    [myHandle, setMyHandle] = useState(""),
    [profile, setProfile] = useState<Profile | null>(null),
    [noFriends, setNoFriends] = useState(false),
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
        const friends =
          mode === "map"
            ? await encounterAPI<{ people: unknown[] }>(
                "/api/v1/me/friends?kind=friends",
              )
            : null;
        const notebook =
          mode === "home"
            ? await encounterAPI<Page>("/api/v1/me/encounters")
            : null;
        if (alive) {
          setReady(true);
          setNoFriends(friends !== null && friends.people.length === 0);
          setOwner(me.user.id);
          setName(me.profile?.handle ?? me.profile?.displayName ?? "Membre");
          setMyHandle(me.profile?.handle ?? "");
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
          {frenchDate(e.encounterDate)}
          {e.owned ? (
            " · par toi"
          ) : (
            <>
              {" · partagé par "}
              {e.authorHandle ? (
                <a href={"/profil/" + e.authorHandle}>{e.author}</a>
              ) : (
                e.author
              )}
            </>
          )}
        </p>
        {mode === "map" && <p>{locationLabel(e.location)}</p>}
      </article>
    );
  }
  return (
    <section aria-busy={busy}>
      {mode === "home" && name && (
        <p className="discovery-greeting">Bonjour {name}</p>
      )}
      <h1>
        {mode === "home"
          ? "Les dernières rencontres."
          : mode === "profile"
            ? (profile?.displayName ?? "Profil du club")
            : mode === "map"
              ? choose
                ? "Choisir un lieu"
                : "Les chats du coin."
              : "Toutes les rencontres."}
      </h1>
      {profile && (
        <div className={"public-profile account-color-" + profile.color}>
          <div className="profile-initial" aria-hidden="true">
            {profile.avatar === "cat" ? (
              <svg viewBox="0 0 24 24">
                <path d="M4 13V3l5 4h6l5-4v10c0 5-4 8-8 8s-8-3-8-8Z" />
                <circle cx="9" cy="12" r="1" />
                <circle cx="15" cy="12" r="1" />
                <path d="m10 16 2 1 2-1" />
              </svg>
            ) : (
              profile.displayName.slice(0, 1).toUpperCase()
            )}
          </div>
          {profile.bio ? (
            <p>{profile.bio}</p>
          ) : (
            profile.handle === myHandle && (
              <p className="public-profile-empty">Pas encore de biographie.</p>
            )
          )}
          {!busy && entries.length > 0 && (
            <p className="public-profile-count">
              {`${entries.length}${next ? "+" : ""} rencontre${entries.length > 1 ? "s" : ""} partagée${entries.length > 1 ? "s" : ""}`}
            </p>
          )}
          {profile.handle === myHandle ? (
            <a className="text-link" href="/profil">
              Modifier mon profil
            </a>
          ) : (
            <a
              className="text-link"
              href={"/amis?q=" + encodeURIComponent(profile.handle)}
            >
              Retrouver ce membre dans mes amis
            </a>
          )}
        </div>
      )}
      <p role="status">{message || (busy ? "Chargement…" : "")}</p>
      {mode === "home" && entries.length > 0 && (
        <a className="text-link" href="/rencontres">
          Voir toutes les rencontres
        </a>
      )}
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
          {choose && (
            <div className="map-choose-head">
              <p>Touche la carte pour placer la zone.</p>
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
                  {([500, 1000, 2000] as const).map((s) => (
                    <option key={s} value={s}>
                      {s === 500 ? "500 m" : s === 1000 ? "1 km" : "2 km"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <LazyZoneMap
            providerKey={providerKey}
            navigationCenter={navigationCenter}
            entries={choose ? noEntries : entries}
            focus={focus}
            selected={selected}
            selectionSize={selectionSize}
            onSelect={choose ? setSelected : undefined}
          />
          {choose && (
            <section className="map-choose">
              <p className="location-current">
                {selected ? locationLabel(selected) : "Aucune zone choisie."}
              </p>
              <div className="map-choose-actions">
                <button
                  className="encounter-button"
                  disabled={!selected}
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
                <a className="encounter-button secondary" href="/photo">
                  Revenir sans lieu
                </a>
              </div>
            </section>
          )}
          {!choose && <h2>Les rencontres de la carte</h2>}
        </>
      )}
      {!choose && (
        <div
          className={
            "notebook-grid" + (mode === "home" ? " discovery-home-grid" : "")
          }
        >
          {entries.map(card)}
        </div>
      )}
      {mode === "map" && ready && noFriends && !choose && (
        <p role="note" className="discovery-hint">
          Tu n’as pas encore d’amis : <a href="/amis">ajoute des gens</a> pour
          voir leurs rencontres sur la carte.
        </p>
      )}
      {!busy && !entries.length && !message && !choose && (
        <p className="discovery-empty">
          {mode === "map"
            ? "Aucune rencontre sur la carte pour l’instant."
            : mode === "profile"
              ? "Aucune rencontre partagée sur ce profil."
              : "Aucune rencontre partagée pour le moment."}
        </p>
      )}
      {next && !choose && (
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
          <h2>
            {own && !entries.some((e) => e.id === own.id)
              ? "Ta dernière rencontre"
              : "Ton carnet"}
          </h2>
          {own ? (
            <>
              {entries.some((e) => e.id === own.id) ? null : card(own)}
              <div className="home-notebook-actions">
                <a className="encounter-button" href="/carnet">
                  Voir tout mon carnet
                </a>
                <a className="encounter-button secondary" href="/photo">
                  Photographier un chat
                </a>
              </div>
            </>
          ) : (
            <>
              <p>Le prochain Polaroid, c’est le tien.</p>
              <a className="encounter-button" href="/photo">
                Photographier un chat
              </a>
            </>
          )}
        </section>
      )}
    </section>
  );
}
