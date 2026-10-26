import { useEffect, useRef, useState } from "react";
import type { EncounterDraft, EncounterView } from "@miaou/contracts";
import { locationLabel } from "./LocationFields";
import { Polaroid } from "./Polaroid";
import { EncounterFields } from "./EncounterFields";
import { encounterAPI, jsonRequest, frenchDate } from "./encounter-api";
export function Notebook({ id }: { id?: string }) {
  const [list, setList] = useState<EncounterView[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [entry, setEntry] = useState<EncounterView | null>(null),
    [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EncounterDraft | null>(null),
    [group, setGroup] = useState(false);
  const [busy, setBusy] = useState(true),
    [message, setMessage] = useState("");
  const [reportReason, setReportReason] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    deleteButton = useRef<HTMLButtonElement>(null),
    editHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    void (async () => {
      try {
        const me = await encounterAPI<{ access: string }>("/api/v1/me");
        if (!alive) return;
        setGroup(me.access === "group");
        if (id) {
          const r = await encounterAPI<{ encounter: EncounterView }>(
            "/api/v1/encounters/" + id,
          );
          if (alive) {
            setEntry(r.encounter);
            setDraft(r.encounter);
          }
        } else {
          const r = await encounterAPI<{
            encounters: EncounterView[];
            next: string | null;
          }>("/api/v1/me/encounters");
          if (alive) {
            setList(r.encounters);
            setNext(r.next);
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
  }, [id]);
  useEffect(() => {
    if (editing) editHeading.current?.focus();
  }, [editing]);
  async function more() {
    setBusy(true);
    try {
      const r = await encounterAPI<{
        encounters: EncounterView[];
        next: string | null;
      }>("/api/v1/me/encounters?after=" + next);
      setList((v) => [
        ...v,
        ...r.encounters.filter((x) => !v.some((e) => e.id === x.id)),
      ]);
      setNext(r.next);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function edit() {
    if (!entry || !draft) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await encounterAPI<{ encounter: EncounterView }>(
        "/api/v1/encounters/" + entry.id,
        jsonRequest(
          {
            title: draft.title,
            description: draft.description,
            encounterDate: draft.encounterDate,
            visibility: draft.visibility,
            location: draft.location ?? null,
            revision: entry.revision,
          },
          "PATCH",
        ),
      );
      setEntry(r.encounter);
      setDraft(r.encounter);
      setEditing(false);
      setMessage("Rencontre modifiée.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!entry) return;
    setBusy(true);
    try {
      await encounterAPI("/api/v1/encounters/" + entry.id, {
        method: "DELETE",
      });
      window.location.assign("/carnet");
    } catch (e) {
      setMessage((e as Error).message);
      dialog.current?.close();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="notebook" aria-busy={busy}>
      <p role="status" aria-live="polite" className="encounter-message">
        {message || (busy ? "Chargement de ton carnet…" : "")}
      </p>
      {!id ? (
        <>
          <h1>Mon petit carnet.</h1>
          <p>Tes rencontres et leurs Polaroids.</p>
          {!group && !busy && (
            <p className="encounter-privacy">
              Ton espace personnel reste accessible. La publication et l’accès
              au groupe sont fermés pour ton compte.
            </p>
          )}
          <div className="encounter-actions">
            {group && list.length > 0 && (
              <a className="encounter-button" href="/photo">
                Ajouter une rencontre
              </a>
            )}
          </div>
          {list.length ? (
            <div className="notebook-grid">
              {list.map((e) => (
                <article key={e.id}>
                  <a href={"/rencontre/" + e.id}>
                    <Polaroid image={e.thumbnail} title={e.title} small />
                  </a>
                  <p className="encounter-meta">
                    {frenchDate(e.encounterDate)}
                    <br />
                    {e.visibility === "private"
                      ? "Privé · toi uniquement"
                      : "Public · membres du club"}
                    {e.hidden && " · masqué"}
                  </p>
                </article>
              ))}
            </div>
          ) : !busy && !message ? (
            <div className="empty-notebook">
              <h2>Le premier Polaroid sera le tien.</h2>
              <p>
                Photographie un chat rencontré et garde ce petit moment ici.
              </p>
              {group && (
                <a className="encounter-button" href="/photo">
                  Ajouter ma première rencontre
                </a>
              )}
            </div>
          ) : null}
          {next && (
            <button
              className="encounter-button secondary"
              disabled={busy}
              onClick={() => void more()}
            >
              Voir les rencontres précédentes
            </button>
          )}
        </>
      ) : (
        <>
          <a className="encounter-link" href="/carnet">
            Retour au carnet
          </a>
          {entry &&
            (editing && draft ? (
              <div className="encounter-editor">
                <aside>
                  <Polaroid image={entry.image} title={entry.title} />
                  <p className="encounter-privacy">
                    La photo et la date de publication restent fixes.
                  </p>
                </aside>
                <div>
                  <h1 ref={editHeading} tabIndex={-1}>
                    Ta rencontre, tes mots.
                  </h1>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void edit();
                    }}
                  >
                    <fieldset disabled={busy}>
                      <EncounterFields
                        value={draft}
                        onChange={setDraft}
                        originalLocation={entry.location}
                      />
                    </fieldset>
                    <div className="encounter-actions">
                      <button className="encounter-button" disabled={busy}>
                        Enregistrer les changements
                      </button>
                      <button
                        className="encounter-button secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDraft(entry);
                          setEditing(false);
                        }}
                      >
                        Annuler
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : (
              <>
                <h1>{entry.title}</h1>
                <div className="encounter-detail">
                  <Polaroid image={entry.image} title={entry.title} />
                  <div>
                    <p className="encounter-description">{entry.description}</p>
                    <p>Rencontré le {frenchDate(entry.encounterDate)}</p>
                    <p className="encounter-meta">
                      Publié le{" "}
                      {new Date(entry.publishedAt).toLocaleDateString("fr-FR")}{" "}
                      · {entry.author}
                    </p>
                    <p className="encounter-privacy">
                      {entry.visibility === "private"
                        ? "Privé · toi uniquement"
                        : "Public · membres du club"}
                      <br />
                      {locationLabel(entry.location)}
                      {entry.location && group && (
                        <a
                          href={
                            "/carte?zone=" +
                            encodeURIComponent(JSON.stringify(entry.location))
                          }
                        >
                          Voir la zone sur la carte
                        </a>
                      )}
                    </p>
                    {entry.hidden && (
                      <p className="encounter-privacy">
                        Cette rencontre est masquée pour les autres membres.{" "}
                        {entry.hiddenReason}
                      </p>
                    )}
                    {!entry.owned && group && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          setBusy(true);
                          void encounterAPI(
                            `/api/v1/encounters/${entry.id}/report`,
                            jsonRequest({ reason: reportReason }),
                          )
                            .then(() => {
                              setReportReason("");
                              setMessage(
                                "Signalement enregistré. Il sera examiné par Gabriel.",
                              );
                            })
                            .catch((e) => setMessage(e.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        <label>
                          Motif du signalement
                          <textarea
                            value={reportReason}
                            onChange={(e) => setReportReason(e.target.value)}
                            required
                            maxLength={1000}
                          />
                        </label>
                        <button
                          className="encounter-button secondary"
                          disabled={busy}
                        >
                          Signaler cette rencontre
                        </button>
                      </form>
                    )}
                    {entry.owned && (
                      <div className="encounter-actions">
                        {group && (
                          <button
                            className="encounter-button secondary"
                            disabled={busy}
                            onClick={() => setEditing(true)}
                          >
                            Modifier la rencontre
                          </button>
                        )}
                        <button
                          ref={deleteButton}
                          className="encounter-link delete-encounter"
                          disabled={busy}
                          onClick={() => dialog.current?.showModal()}
                        >
                          Supprimer ma rencontre
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ))}
          <dialog
            ref={dialog}
            className="encounter-dialog"
            aria-labelledby="delete-title"
            onClose={() => deleteButton.current?.focus()}
          >
            <h2 id="delete-title">Supprimer cette rencontre ?</h2>
            <p>
              La rencontre sera retirée de ton carnet et sa photo supprimée.
              Cette action est définitive.
            </p>
            <div className="encounter-actions">
              <button
                autoFocus
                className="encounter-button secondary"
                disabled={busy}
                onClick={() => dialog.current?.close()}
              >
                Garder la rencontre
              </button>
              <button
                className="encounter-button"
                disabled={busy}
                onClick={() => void remove()}
              >
                Confirmer la suppression
              </button>
            </div>
          </dialog>
        </>
      )}
    </section>
  );
}
