import { useEffect, useRef, useState } from "react";
import type {
  EncounterDraft,
  EncounterView,
  MediaView,
} from "@miaou/contracts";
import { LazyZoneMap } from "./LazyZoneMap";
import { locationLabel } from "./LocationFields";
import { Polaroid } from "./Polaroid";
import { EncounterFields } from "./EncounterFields";
import {
  EncounterAPIError,
  encounterAPI,
  jsonRequest,
  localToday,
  photoMessage,
  frenchDate,
} from "./encounter-api";
type Saved = {
  media: MediaView;
  draft: EncounterDraft;
  key: string;
  step: "describe" | "preview";
};
export function PhotoFlow() {
  const [step, setStep] = useState<"choose" | "describe" | "preview">("choose");
  const [draft, setDraft] = useState<EncounterDraft>({
    title: "",
    description: "",
    encounterDate: localToday(),
    visibility: "public",
  });
  const [media, setMedia] = useState<MediaView | null>(null);
  const [key, setKey] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const camera = useRef<HTMLInputElement>(null),
    gallery = useRef<HTMLInputElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let alive = true;
    void encounterAPI<{ user: { id: string }; access: string }>("/api/v1/me")
      .then(async (me) => {
        if (!alive) return;
        if (me.access !== "group") {
          window.location.assign("/profil");
          return;
        }
        const name = "miaou-draft-" + me.user.id;
        try {
          const saved = JSON.parse(
            sessionStorage.getItem(name) ?? "null",
          ) as Saved | null;
          if (saved && Date.parse(saved.media.expiresAt) > Date.now()) {
            const latest = await encounterAPI<{ media: MediaView }>(
              "/api/v1/media/" + saved.media.id,
            );
            if (alive) {
              setMedia(latest.media);
              setDraft(saved.draft);
              setKey(saved.key);
              setStep(saved.step);
            }
          } else if (saved) {
            try {
              sessionStorage.removeItem(name);
            } catch {
              /* Storage may be disabled. */
            }
          }
        } catch (error) {
          if (error instanceof EncounterAPIError && error.status !== 404) {
            if (alive) setMessage(error.message);
          } else {
            try {
              sessionStorage.removeItem(name);
            } catch {
              /* Storage can be disabled. */
            }
          }
        }
        if (alive) {
          try {
            const selected = sessionStorage.getItem(
              "miaou-selected-cell-" + me.user.id,
            );
            if (selected) {
              try {
                const { cell } =
                  await import("../../server/src/encounters/location");
                if (!alive) return;
                const location = cell(JSON.parse(selected));
                setDraft((old) => ({
                  ...old,
                  location,
                  locationMethod: "map",
                }));
                if (sessionStorage.getItem("miaou-draft-" + me.user.id))
                  setStep("describe");
              } catch {
                if (!alive) return;
                setMessage(
                  "La zone choisie n’a pas pu être chargée. Le lieu précédent est conservé. Choisis à nouveau une zone sur la carte.",
                );
              }
              sessionStorage.removeItem("miaou-selected-cell-" + me.user.id);
            }
          } catch {
            /* Invalid selection or browser storage unavailable. */
          }
          setOwner(me.user.id);
        }
      })
      .catch((e) => {
        if (alive) setMessage(e.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!owner || !media || step === "choose") return;
    try {
      sessionStorage.setItem(
        "miaou-draft-" + owner,
        JSON.stringify({ media, draft, key, step }),
      );
    } catch {
      /* The form still works when browser storage is unavailable. */
    }
  }, [owner, media, draft, key, step]);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  useEffect(() => {
    if (!media || !["pending", "processing", "uploading"].includes(media.state))
      return;
    let alive = true,
      count = 0;
    const timer = setInterval(() => {
      count++;
      if (count > 60) {
        clearInterval(timer);
        if (alive)
          setMessage(
            "Le traitement prend plus de temps. Recharge cette page pour reprendre son suivi.",
          );
        return;
      }
      void encounterAPI<{ media: MediaView }>("/api/v1/media/" + media.id)
        .then((r) => {
          if (alive) setMedia(r.media);
        })
        .catch((e) => {
          clearInterval(timer);
          if (alive) setMessage(e.message);
        });
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [media?.id, media?.state]);
  useEffect(() => {
    if (!owner || !media) return;
    const remaining = Date.parse(media.expiresAt) - Date.now();
    const timer = setTimeout(
      () => {
        try {
          sessionStorage.removeItem("miaou-draft-" + owner);
        } catch {
          /* Storage may be disabled. */
        }
        setMedia(null);
        setStep("choose");
        setDraft({
          title: "",
          description: "",
          encounterDate: localToday(),
          visibility: "public",
        });
        setMessage("Le brouillon a expiré. Choisis à nouveau ta photo.");
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [owner, media?.id, media?.expiresAt]);
  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 30000000) {
      setMessage(photoMessage("photo_size"));
      return;
    }
    setBusy(true);
    setMessage("Envoi et préparation de ta photo…");
    try {
      const r = await encounterAPI<{ media: MediaView }>("/api/v1/media", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      });
      if (media)
        void encounterAPI("/api/v1/media/" + media.id, {
          method: "DELETE",
        }).catch(() => {});
      setMedia(r.media);
      setKey(crypto.randomUUID());
      setStep("describe");
      setMessage(
        r.media.state === "ready"
          ? "Photo prête."
          : "Photo reçue. Le traitement peut être repris ici.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function abandon() {
    if (!media) return;
    setBusy(true);
    try {
      await encounterAPI("/api/v1/media/" + media.id, { method: "DELETE" });
      try {
        sessionStorage.removeItem("miaou-draft-" + owner);
      } catch {
        /* Storage may be disabled. */
      }
      setMedia(null);
      setKey("");
      setDraft({
        title: "",
        description: "",
        encounterDate: localToday(),
        visibility: "public",
      });
      setStep("choose");
      setMessage("Brouillon effacé.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    if (!media) return;
    setBusy(true);
    try {
      const r = await encounterAPI<{ media: MediaView }>(
        "/api/v1/media/" + media.id + "/retry",
        { method: "POST" },
      );
      setMedia(r.media);
      setMessage(
        r.media.state === "ready"
          ? "Photo prête."
          : photoMessage(r.media.error),
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!media) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await encounterAPI<{ encounter: EncounterView }>(
        "/api/v1/encounters",
        jsonRequest({ ...draft, mediaId: media.id }, "POST", {
          "idempotency-key": key,
        }),
      );
      try {
        sessionStorage.removeItem("miaou-draft-" + owner);
      } catch {
        /* Publication is already durable. */
      }
      window.location.assign("/rencontre/" + r.encounter.id + "?publie=1");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const pickers = (
    <>
      <input
        ref={camera}
        className="photo-file"
        tabIndex={-1}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        aria-label="Prendre une photo"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={gallery}
        className="photo-file"
        tabIndex={-1}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        aria-label="Choisir une photo dans la galerie"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
  return (
    <section className="photo-flow" aria-busy={busy}>
      {pickers}
      <p className="encounter-message" role="status" aria-live="polite">
        {message}
      </p>
      {step !== "choose" && (
        <div className="draft-notice">
          <p>
            Ton brouillon reste dans cet onglet pendant 24 h maximum, jusqu’à sa
            fermeture ou ta déconnexion.
          </p>
          <button
            className="encounter-link"
            disabled={busy}
            onClick={() => void abandon()}
          >
            Effacer le brouillon
          </button>
        </div>
      )}
      {step === "choose" ? (
        <>
          <h1 ref={heading} tabIndex={-1}>
            À toi de photographier.
          </h1>
          <div className="capture-frame">
            <svg
              className="capture-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M3 7h5l2-3h4l2 3h5v13H3Z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <p>Une rencontre à garder ?</p>
            <button
              className="encounter-button"
              disabled={busy || !owner}
              onClick={() => camera.current?.click()}
            >
              Prendre une photo
            </button>
          </div>
          <button
            className="encounter-link capture-gallery"
            disabled={busy || !owner}
            onClick={() => gallery.current?.click()}
          >
            Choisir dans la galerie
          </button>
          <p className="photo-help">
            JPEG, PNG ou WebP · 30 Mo et 60 Mpx maximum.
            <br />
            Pour une photo HEIC, choisis une copie JPEG.
          </p>
        </>
      ) : step === "describe" ? (
        <div className="encounter-editor">
          <aside>
            {media?.image ? (
              <Polaroid image={media.image} title="Bientôt dans ton carnet." />
            ) : (
              <div className="photo-pending">
                <p>
                  {media?.state === "failed"
                    ? photoMessage(media.error)
                    : "Préparation de ta photo…"}
                </p>
                {media?.state === "failed" && (
                  <button
                    disabled={busy}
                    className="encounter-button"
                    onClick={() => void retry()}
                  >
                    Réessayer le traitement
                  </button>
                )}
              </div>
            )}
          </aside>
          <div>
            <h1 ref={heading} tabIndex={-1}>
              Une nouvelle rencontre.
            </h1>
            <p>Un Polaroid, quelques mots, et la rencontre est gardée.</p>
            <div className="photo-replace">
              <button
                className="encounter-link"
                disabled={busy}
                onClick={() => camera.current?.click()}
              >
                Reprendre la photo
              </button>
              <button
                className="encounter-link"
                disabled={busy}
                onClick={() => gallery.current?.click()}
              >
                Choisir dans la galerie
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setStep("preview");
                setMessage("");
              }}
            >
              <fieldset disabled={busy}>
                <EncounterFields value={draft} onChange={setDraft} />
              </fieldset>
              <button
                className="encounter-button"
                disabled={busy || media?.state !== "ready"}
              >
                Voir l’aperçu
              </button>
            </form>
          </div>
        </div>
      ) : (
        <>
          <h1 ref={heading} tabIndex={-1}>
            Prêt à rejoindre le carnet ?
          </h1>
          <p>
            {draft.visibility === "private"
              ? "Cette rencontre sera visible uniquement par toi."
              : "Voici ce que les membres du club pourront voir."}
          </p>
          <div className="encounter-detail">
            {media?.image && (
              <Polaroid image={media.image} title={draft.title} />
            )}
            <div>
              <h2>{draft.title}</h2>
              <p className="encounter-description">{draft.description}</p>
              <p>{frenchDate(draft.encounterDate)}</p>
              <p className="encounter-privacy">
                {draft.visibility === "private"
                  ? "Privé · toi uniquement"
                  : "Public · membres du club"}
                <br />
                {locationLabel(draft.location)}
              </p>
              {draft.location && <LazyZoneMap selected={draft.location} />}
              <div className="encounter-actions">
                <button
                  className="encounter-button"
                  disabled={busy}
                  onClick={() => void publish()}
                >
                  Publier la rencontre
                </button>
                <button
                  className="encounter-button secondary"
                  disabled={busy}
                  onClick={() => setStep("describe")}
                >
                  Modifier
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
